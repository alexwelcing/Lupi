import Foundation
import LupiGame
import Testing

/// Recorded touch streams through the arbiter (scale-spec §10.5).
@Suite("gesture arbiter")
struct GestureTests {
    let toy = TouchTarget.toy(BodyID(7))
    let monument = TouchTarget.monument(BodyID(9))

    func t(_ id: Int, _ phase: TouchSample.Phase, _ x: Double, _ y: Double, _ time: Double) -> TouchSample {
        TouchSample(id: id, phase: phase, location: SIMD2(x, y), time: time)
    }

    @Test func aQuickStillTouchIsATap() {
        var a = GestureArbiter()
        #expect(a.handle(t(1, .began, 100, 100, 0), target: toy).isEmpty)
        #expect(a.handle(t(1, .moved, 103, 102, 0.05), target: .none).isEmpty)
        #expect(a.handle(t(1, .ended, 103, 102, 0.1), target: .none) == [.tap(toy, SIMD2(100, 100))])
        #expect(a.isIdle)
        // On empty space too: it deselects.
        _ = a.handle(t(2, .began, 10, 10, 1), target: .none)
        #expect(a.handle(t(2, .ended, 10, 10, 1.1), target: .none) == [.tap(.none, SIMD2(10, 10))])
    }

    @Test func movingEightPointsOnAToyGrabsIt() {
        var a = GestureArbiter()
        _ = a.handle(t(1, .began, 100, 100, 0), target: toy)
        #expect(a.handle(t(1, .moved, 104, 100, 0.03), target: .none).isEmpty)
        #expect(a.handle(t(1, .moved, 109, 100, 0.05), target: .none) == [.grabBegan(BodyID(7), SIMD2(100, 100)), .grabMoved(SIMD2(109, 100))])
        #expect(a.grabbed == BodyID(7))
        #expect(a.handle(t(1, .moved, 150, 60, 0.08), target: .none) == [.grabMoved(SIMD2(150, 60))])
        #expect(a.handle(t(1, .ended, 160, 40, 0.1), target: .none) == [.grabEnded(SIMD2(160, 40), cancelled: false)])
        #expect(a.isIdle)
    }

    @Test func holdingStill120msGrabs() {
        var a = GestureArbiter()
        _ = a.handle(t(1, .began, 100, 100, 0), target: toy)
        #expect(a.tick(0.1).isEmpty)
        #expect(a.tick(0.121) == [.grabBegan(BodyID(7), SIMD2(100, 100))])
        // A slow tap after the grab is a set-down, not a tap.
        #expect(a.handle(t(1, .ended, 100, 100, 0.2), target: .none) == [.grabEnded(SIMD2(100, 100), cancelled: false)])
    }

    @Test func aSecondFingerDuringAGrabPinchesTheHeldBody() {
        var a = GestureArbiter()
        _ = a.handle(t(1, .began, 100, 100, 0), target: toy)
        _ = a.handle(t(1, .moved, 120, 100, 0.02), target: .none)
        let began = a.handle(t(2, .began, 220, 100, 0.1), target: .none)
        #expect(began == [.pinchBegan(centroid: SIMD2(170, 100), held: BodyID(7), target: toy)])
        let change = a.handle(t(2, .moved, 320, 100, 0.15), target: .none)
        guard case let .pinchChanged(_, ratio, twist)? = change.first else {
            Issue.record("no pinch change")
            return
        }
        #expect(abs(ratio - 2) < 1e-12)
        #expect(abs(twist) < 1e-12)
        // Lifting the second finger leaves the body held by the first.
        #expect(a.handle(t(2, .ended, 320, 100, 0.2), target: .none) == [.pinchEnded])
        #expect(a.grabbed == BodyID(7))
        #expect(a.handle(t(1, .ended, 120, 100, 0.3), target: .none) == [.grabEnded(SIMD2(120, 100), cancelled: false)])
    }

    @Test func aSnapRetargetsTheHeldBody() {
        var a = GestureArbiter()
        _ = a.handle(t(1, .began, 100, 100, 0), target: toy)
        _ = a.handle(t(1, .moved, 120, 100, 0.02), target: .none)
        // The held body merged into a new one: the finger holds that one now.
        a.retarget(BodyID(7), to: BodyID(12))
        #expect(a.grabbed == BodyID(12))
        // A second finger pinches the new body.
        #expect(a.handle(t(2, .began, 220, 100, 0.1), target: .none) == [.pinchBegan(centroid: SIMD2(170, 100), held: BodyID(12), target: .toy(BodyID(12)))])
        a.retarget(BodyID(12), to: BodyID(13))
        #expect(a.grabbed == BodyID(13))
        // Another body's id changes nothing.
        a.retarget(BodyID(99), to: BodyID(1))
        #expect(a.grabbed == BodyID(13))
    }

    @Test func twoFingersSpreadingTwelvePointsPinchAndTwist() {
        var a = GestureArbiter()
        _ = a.handle(t(1, .began, 100, 300, 0), target: toy)
        _ = a.handle(t(2, .began, 200, 300, 0.01), target: .none)
        #expect(a.handle(t(2, .moved, 205, 300, 0.05), target: .none).isEmpty)
        let out = a.handle(t(2, .moved, 213, 300, 0.06), target: .none)
        #expect(out.first == .pinchBegan(centroid: SIMD2(156.5, 300), held: nil, target: toy))
        // Rotating the second finger about the first turns clockwise on screen.
        let twist = a.handle(t(2, .moved, 100, 413, 0.1), target: .none)
        guard case let .pinchChanged(_, _, angle)? = twist.first else {
            Issue.record("no twist")
            return
        }
        #expect(abs(angle - .pi / 2) < 1e-9)
        #expect(a.handle(t(1, .ended, 100, 300, 0.2), target: .none) == [.pinchEnded])
        // The remaining finger is ignored until it lifts.
        #expect(a.handle(t(2, .moved, 0, 0, 0.25), target: .none).isEmpty)
        #expect(a.handle(t(2, .ended, 0, 0, 0.3), target: .none).isEmpty)
        #expect(a.isIdle)
    }

    @Test func twoStillFingersFlyOnlyBeyondTenToThe32() {
        var a = GestureArbiter()
        _ = a.handle(t(1, .began, 100, 300, 0), target: .none)
        _ = a.handle(t(2, .began, 200, 300, 0.01), target: .none)
        #expect(a.tick(0.5).isEmpty)
        a.flyAllowed = true
        #expect(a.tick(0.6) == [.flyBegan(direction: 1)])
        // A separation change turns flight back into a pinch.
        let back = a.handle(t(2, .moved, 215, 300, 0.7), target: .none)
        #expect(back == [.flyEnded, .pinchBegan(centroid: SIMD2(157.5, 300), held: nil, target: .none)])
    }

    @Test func monumentsGiveChunksAndChips() {
        var a = GestureArbiter()
        _ = a.handle(t(1, .began, 50, 50, 0), target: monument)
        #expect(a.handle(t(1, .moved, 70, 50, 0.1), target: .none) == [.chunk(BodyID(9), SIMD2(50, 50))])
        _ = a.handle(t(1, .ended, 70, 50, 0.2), target: .none)
        var b = GestureArbiter()
        _ = b.handle(t(3, .began, 50, 50, 1), target: monument)
        #expect(b.tick(1.41).isEmpty)
        #expect(b.handle(t(3, .moved, 70, 50, 1.5), target: .none) == [.chip(BodyID(9), SIMD2(50, 50))])
        // A toy is always grabbed whole, never chipped.
        var c = GestureArbiter()
        _ = c.handle(t(4, .began, 50, 50, 2), target: toy)
        #expect(c.tick(2.5) == [.grabBegan(BodyID(7), SIMD2(50, 50))])
    }
}
