// Stand-in for the Keychain calls, with Apple's names; CF types as their Foundation twins.
import Foundation
public typealias OSStatus = Int32
public typealias CFTypeRef = AnyObject
public typealias CFDictionary = NSDictionary
public typealias CFString = NSString
public let errSecSuccess: OSStatus = 0
public let errSecItemNotFound: OSStatus = -25300
nonisolated(unsafe) public let kSecClass: CFString = "class"
nonisolated(unsafe) public let kSecClassGenericPassword: CFString = "genp"
nonisolated(unsafe) public let kSecAttrService: CFString = "svce"
nonisolated(unsafe) public let kSecAttrAccount: CFString = "acct"
nonisolated(unsafe) public let kSecReturnData: CFString = "r_Data"
nonisolated(unsafe) public let kSecMatchLimit: CFString = "m_Limit"
nonisolated(unsafe) public let kSecMatchLimitOne: CFString = "m_LimitOne"
nonisolated(unsafe) public let kSecValueData: CFString = "v_Data"
nonisolated(unsafe) public let kSecAttrAccessible: CFString = "pdmn"
nonisolated(unsafe) public let kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly: CFString = "cku"
nonisolated(unsafe) public let kSecAttrSynchronizable: CFString = "sync"
public let kCFBooleanFalse: NSNumber? = NSNumber(value: false)
public func SecItemCopyMatching(_ query: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus { 0 }
public func SecItemAdd(_ attributes: CFDictionary, _ result: UnsafeMutablePointer<CFTypeRef?>?) -> OSStatus { 0 }
public func SecItemUpdate(_ query: CFDictionary, _ attributesToUpdate: CFDictionary) -> OSStatus { 0 }
public func SecItemDelete(_ query: CFDictionary) -> OSStatus { 0 }
