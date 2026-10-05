import AuthenticationServices
import LupiAuth
import LupiGame
import SwiftUI

/// Settings' account sections (plan §6.2): Sign in with Apple, sync, sign out, and deleting the
/// account in the app (App Store Review Guideline 5.1.1(v)). Signed out, everything still works.
struct AccountSections: View {
    @Environment(AppModel.self) private var app
    @State private var appleSignIn = AppleSignIn()
    @State private var deleting = false
    @State private var confirmingErase = false

    var body: some View {
        let collection = app.collection
        Section {
            switch collection.status {
            case .unavailable:
                Text("This build has no Lupi account configured. Your collection stays on this device.")
                    .foregroundStyle(.secondary)
            case .signedOut:
                SignInWithAppleButton(.signIn) { request in
                    appleSignIn.prepare(request)
                } onCompletion: { result in
                    signIn(result)
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 44)
            case .signedIn:
                Label("Signed in with Apple", systemImage: "checkmark.seal")
                Button {
                    Task { await collection.sync(full: true) }
                } label: {
                    if collection.syncing { ProgressView() } else { Text("Sync now") }
                }
                Button("Sign out") { Task { await collection.signOut() } }
                Button("Delete account", role: .destructive) { deleting = true }
            case .deletionPending:
                Text("Deleting your account did not finish.")
                Button("Finish deleting your account", role: .destructive) { deleting = true }
            }
            if let notice = collection.notice {
                Text(notice)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } header: {
            Text("Lupi account")
        } footer: {
            Text("Signed in, your collection follows you to your other iPhone or iPad. Rooms and shelves never leave this device.")
        }
        Section {
            Button("Erase this device's collection", role: .destructive) { confirmingErase = true }
        } footer: {
            Text("Removes every trophy, room and shelf from this device. Trophies on your Lupi account stay there.")
        }
        .confirmationDialog("Erase this device's collection?", isPresented: $confirmingErase, titleVisibility: .visible) {
            Button("Erase", role: .destructive) { Task { await collection.eraseDevice() } }
        }
        .sheet(isPresented: $deleting) {
            DeleteAccountSheet()
                .environment(app)
        }
    }

    private func signIn(_ result: Result<ASAuthorization, any Error>) {
        do {
            guard let credential = try appleSignIn.credential(from: result) else { return }
            Task { await app.collection.signIn(credential) }
        } catch {
            app.collection.report("Sign in with Apple failed: \(error.localizedDescription)")
        }
    }
}

/// Deleting the account (account-and-sync.md §5): a fresh Sign in with Apple gives the
/// authorization code that revokes Apple's tokens; then the trophies, the tokens and the user go,
/// in that order.
struct DeleteAccountSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var appleSignIn = AppleSignIn()
    @State private var eraseDevice = false
    @State private var working = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This deletes your Lupi account and every trophy on it, on all your devices, and stops Lupi using your Apple ID. It cannot be undone.")
                    Text("Trophies you kept while signed out stay on this device. Rooms and shelves stay too, unless you erase them below.")
                        .foregroundStyle(.secondary)
                }
                Section {
                    Toggle("Also erase this device's collection", isOn: $eraseDevice)
                }
                Section {
                    if working {
                        ProgressView("Deleting")
                    } else {
                        SignInWithAppleButton(.continue) { request in
                            appleSignIn.prepare(request)
                        } onCompletion: { result in
                            delete(result)
                        }
                        .signInWithAppleButtonStyle(.white)
                        .frame(height: 44)
                    }
                } footer: {
                    Text("Apple asks you to confirm with Sign in with Apple once more.")
                }
                if let notice = app.collection.notice {
                    Section { Text(notice).font(.footnote) }
                }
            }
            .navigationTitle("Delete account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }

    private func delete(_ result: Result<ASAuthorization, any Error>) {
        do {
            guard let credential = try appleSignIn.credential(from: result) else { return }
            working = true
            Task {
                let done = await app.collection.deleteAccount(credential, eraseDevice: eraseDevice)
                working = false
                if done { dismiss() }
            }
        } catch {
            app.collection.report("Sign in with Apple failed: \(error.localizedDescription)")
        }
    }
}
