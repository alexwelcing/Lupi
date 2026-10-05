import LupiGame
import SwiftUI
import UIKit

/// A transparent view over the RealityView that reports raw touches, with UIKit's timestamps,
/// to the session's gesture arbiter (scale-spec §10.5), and its size, scale and interface
/// orientation for the camera's rays.
struct TouchLayer: UIViewRepresentable {
    let onTouches: @MainActor ([TouchSample]) -> Void
    let onLayout: @MainActor (CGSize, CGFloat, UIInterfaceOrientation) -> Void

    func makeUIView(context: Context) -> TouchCaptureView {
        let view = TouchCaptureView()
        view.onTouches = onTouches
        view.onLayout = onLayout
        return view
    }

    func updateUIView(_ view: TouchCaptureView, context: Context) {
        view.onTouches = onTouches
        view.onLayout = onLayout
    }
}

final class TouchCaptureView: UIView {
    var onTouches: (@MainActor ([TouchSample]) -> Void)?
    var onLayout: (@MainActor (CGSize, CGFloat, UIInterfaceOrientation) -> Void)?
    private var ids: [ObjectIdentifier: Int] = [:]
    private var nextTouchID = 1

    override init(frame: CGRect) {
        super.init(frame: frame)
        isMultipleTouchEnabled = true
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) { fatalError("TouchCaptureView is made in code") }

    override func layoutSubviews() {
        super.layoutSubviews()
        report()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        report()
    }

    func report() {
        let orientation = window?.windowScene?.effectiveGeometry.interfaceOrientation ?? .portrait
        onLayout?(bounds.size, traitCollection.displayScale, orientation)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) { send(touches, .began) }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) { send(touches, .moved) }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) { send(touches, .ended) }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) { send(touches, .cancelled) }

    private func send(_ touches: Set<UITouch>, _ phase: TouchSample.Phase) {
        var samples: [TouchSample] = []
        for touch in touches.sorted(by: { $0.timestamp < $1.timestamp }) {
            let key = ObjectIdentifier(touch)
            let id: Int
            if let known = ids[key] {
                id = known
            } else {
                id = nextTouchID
                nextTouchID += 1
                ids[key] = id
            }
            let p = touch.location(in: self)
            samples.append(TouchSample(id: id, phase: phase, location: SIMD2(Double(p.x), Double(p.y)), time: touch.timestamp))
            if phase == .ended || phase == .cancelled { ids[key] = nil }
        }
        onTouches?(samples)
    }
}
