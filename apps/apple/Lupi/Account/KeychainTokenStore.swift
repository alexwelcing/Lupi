import Foundation
import LupiAuth
import Security

/// The Firebase session in the Keychain (account-and-sync.md §2, step 4): one generic password,
/// readable after the first unlock, on this device only, never synchronized. SecItem calls block,
/// so they run on the session manager's actor, never the main thread.
final class KeychainTokenStore: TokenStore, Sendable {
    private let service: String
    private let account: String

    init(service: String = "live.lupi.app.session", account: String = "firebase") {
        self.service = service
        self.account = account
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    func load() async throws -> Session? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw KeychainError(status: status) }
        return try JSONDecoder().decode(Session.self, from: data)
    }

    func save(_ session: Session) async throws {
        let data = try JSONEncoder().encode(session)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add.merge(attributes) { $1 }
            add[kSecAttrSynchronizable as String] = kCFBooleanFalse
            status = SecItemAdd(add as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    func clear() async throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status) }
    }
}

struct KeychainError: Error, CustomStringConvertible {
    let status: OSStatus
    var description: String { "Keychain error \(status)" }
}
