import Foundation
import Testing
import LupiChem
@testable import LupiPlay

private let view = ThrowView(forward: Vec3(0, 0, -1), right: Vec3(1, 0, 0))

/// Samples at 60 Hz ending at t = 1 s, from a world path and a screen path.
private func held(
    seconds: Double = 0.2, rate: Double = 60,
    world: (Double) -> Vec3, screen: (Double) -> SIMD2<Double> = { _ in SIMD2(200, 400) }
) -> ThrowEstimator {
    var estimator = ThrowEstimator()
    let count = Int(seconds * rate)
    for k in 0...count {
        let t = 1 - Double(count - k) / rate
        estimator.add(HandSample(time: t, world: world(t), screen: screen(t)))
    }
    return estimator
}

private func near(_ a: Vec3, _ b: Vec3, _ tolerance: Double = 1e-9) -> Bool { (a - b).length <= tolerance }

@Suite("throw estimator")
struct ThrowTests {
    @Test func steadyHandThrowsAtItsVelocity() {
        let v = Vec3(1, 0.5, -2)
        let release = held { t in Vec3(0.1, 1.2, -0.5) + v * t }.release(at: 1, view: view)
        #expect(!release.held)
        #expect(near(release.hand, v))
        #expect(near(release.linear, v))
        #expect(release.flick == .zero)
        // 1 m/s sideways → 2 rad/s about forward × right (the near face rolls on the hand).
        #expect(near(release.angular, Vec3(0, -2, 0)))
        #expect(near(release.linearImpulse(mass: 0.2), v * 0.2))
    }

    @Test func onlyTheLastHundredMillisecondsCount() {
        // Fast for most of the drag, then a slower last 100 ms: the slower speed is the throw.
        let release = held(seconds: 0.4) { t in
            t < 0.88 ? Vec3(5 * t, 0, 0) : Vec3(5 * 0.88 + (t - 0.88), 0, 0)
        }.release(at: 1, view: view)
        #expect(abs(release.hand.x - 1) < 1e-9)
    }

    @Test func aPauseOrTooFewSamplesSetsItDown() {
        let moving = held { t in Vec3(t, 0, 0) }
        #expect(moving.release(at: 1 + ThrowTuning.pause + 0.01, view: view) == .setDown)
        var sparse = ThrowEstimator()
        sparse.add(HandSample(time: 0.95, world: .zero, screen: .zero))
        sparse.add(HandSample(time: 1.0, world: Vec3(0.1, 0, 0), screen: .zero))
        #expect(sparse.release(at: 1, view: view) == .setDown)
        // A burst with one timestamp has no slope.
        var burst = ThrowEstimator()
        for k in 0..<4 { burst.add(HandSample(time: 1, world: Vec3(Double(k), 0, 0), screen: .zero)) }
        #expect(burst.release(at: 1, view: view) == .setDown)
        #expect(ThrowEstimator().release(at: 1, view: view) == .setDown)
    }

    @Test func badSamplesAreDropped() {
        var estimator = held { t in Vec3(t, 0, 0) }
        let count = estimator.samples.count
        estimator.add(HandSample(time: .nan, world: .zero, screen: .zero))
        estimator.add(HandSample(time: 0.5, world: .zero, screen: .zero))
        #expect(estimator.samples.count == count)
        // Old samples fall out of the history.
        estimator.add(HandSample(time: 2, world: .zero, screen: .zero))
        #expect(estimator.samples.count == 1)
    }

    @Test func anUpwardFlickThrowsForward() {
        // The hand holds still while the finger flicks up the screen at 2,000 pt/s.
        let release = held(world: { _ in Vec3(0, 1, -0.5) }, screen: { t in SIMD2(200, 400 - 2000 * t) })
            .release(at: 1, view: view)
        #expect(near(release.flick, Vec3(0, 0, -5), 1e-6))
        #expect(near(release.linear, Vec3(0, 0, -5), 1e-6))
        // A downward flick adds nothing.
        let down = held(world: { _ in .zero }, screen: { t in SIMD2(200, 400 + 2000 * t) }).release(at: 1, view: view)
        #expect(down.flick == .zero)
    }

    @Test func speedIsCappedAndComfortCapsMore() {
        let v = Vec3(6, 0, -9)
        let path = held { t in v * t }
        for (comfort, cap) in [(MotionComfort.standard, 8.0), (.gentle, 4), (.still, 1.5)] {
            let release = path.release(at: 1, view: view, comfort: comfort)
            #expect(abs(release.linear.length - cap) < 1e-9, "\(comfort)")
            #expect(near(release.linear.normalized, v.normalized), "\(comfort)")
        }
        // Gentle halves the spin; Still has none.
        let standard = path.release(at: 1, view: view).angular
        let gentle = path.release(at: 1, view: view, comfort: .gentle).angular
        #expect(path.release(at: 1, view: view, comfort: .still).angular == .zero)
        // Gentle's spin is half of its own (slower) sideways speed's.
        #expect(near(gentle, Vec3(0, -2 * 4 * 6 / v.length, 0) * 0.5, 1e-9))
        #expect(near(standard, Vec3(0, -2 * 8 * 6 / v.length, 0), 1e-9))
    }

    @Test func spinIsCapped() {
        let release = held { t in Vec3(8, 0, 0) * t }.release(at: 1, view: view, grabOffset: Vec3(0, 0.02, 0))
        #expect(abs(release.angular.length - ThrowTuning.maxSpin) < 1e-9)
    }

    @Test func anOffCentreGrabIsALever() {
        // Grabbed 10 cm above the centre and pushed into the screen at 1 m/s: the top leads.
        let release = held { t in Vec3(0, 0, -t) }.release(at: 1, view: view, grabOffset: Vec3(0, 0.1, 0))
        #expect(near(release.angular, Vec3(-5, 0, 0), 1e-9))
        let leading = release.angular.cross(Vec3(0, 0.1, 0))
        #expect(near(leading, Vec3(0, 0, -0.5), 1e-9))
        // A grab at the centre counts as 2 cm off, never a division by zero.
        let centre = held { t in Vec3(0, 0, -t) }.release(at: 1, view: view, grabOffset: .zero)
        #expect(centre.angular == .zero)
    }

    @Test func aCurvingDragSpinsWithIt() {
        // 1 m/s round a 20 cm circle in the plane of up and forward: the hand turns at 5 rad/s about x.
        let radius = 0.2
        let release = held { t in
            let angle = t / radius
            return Vec3(0, radius * sin(angle), -radius * cos(angle))
        }.release(at: 1, view: view)
        let expected = Vec3(ThrowTuning.curlGain * 5, 0, 0)
        #expect((release.angular - expected).length < 0.05 * expected.length, "\(release.angular)")
        // A straight drag does not curl.
        #expect(held { t in Vec3(0, t, 0) }.release(at: 1, view: view).angular == .zero)
    }

    @Test func slopeAndParabolaFits() throws {
        let times = [0.0, 0.01, 0.025, 0.04, 0.05]
        let values = times.map { t in Vec3(1 + 2 * t + 3 * t * t, -t, 4 * t * t) }
        let a = try #require(ThrowEstimator.acceleration(times, values))
        #expect(near(a, Vec3(6, 0, 8), 1e-6))
        #expect(ThrowEstimator.acceleration([0, 0.01], [.zero, .zero]) == nil)
        #expect(ThrowEstimator.slope([1, 1, 1], [.zero, Vec3(1, 0, 0), .zero]) == nil)
    }
}
