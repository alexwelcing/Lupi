import LupiGame
import SwiftUI

/// The first-run card (plan §8 M4): one card that explains the camera before iOS asks for it,
/// and the way to Settings when the answer was no. The words are LupiGame's `OnboardingCard`.
struct OnboardingView: View {
    let card: OnboardingCard
    @Environment(AppModel.self) private var app

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Image(systemName: card == .camera ? "camera.viewfinder" : "camera.badge.ellipsis")
                .font(.system(size: 44, weight: .semibold))
                .foregroundStyle(Color.lime)
                .accessibilityHidden(true)
            Text(card.title)
                .font(.title2.weight(.bold))
            ForEach(card.body, id: \.self) { line in
                Text(line)
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if let action = card.action {
                Button {
                    Task { await app.continueOnboarding() }
                } label: {
                    Text(action)
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 6)
                }
                .buttonStyle(.borderedProminent)
            }
            Button("Not now") { app.dismissOnboarding() }
                .frame(maxWidth: .infinity)
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(24)
        .frame(maxWidth: 520)
        .background(Color.sage.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }
}
