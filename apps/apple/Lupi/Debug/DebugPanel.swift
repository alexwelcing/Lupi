import SwiftUI

/// The debug HUD (plan §8 M0), behind a long press on the Lupi badge: frame time, bodies, the
/// cut's counts, thermal state and the last impulse, with the day-one device spikes.
struct DebugPanel: View {
    @Bindable var controller: PlayController
    @State private var showingSoundLab = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 6) {
                lines(controller.hudLines)
                Divider().overlay(Color.white.opacity(0.3))
                HStack {
                    Button("A1 save shelf map") { controller.saveShelfMap() }
                    Button("A1 relocalize") { controller.relocalizeShelf() }
                    Button("A1 copy log") { controller.copyA1Log() }
                }
                Toggle("A2 custom simulation + clock", isOn: $controller.spikes.customSimulation)
                Button("A2 quarter speed for 2 s") { controller.slowMotionTest() }
                Button("A3 toss the selected body") { controller.tumbleTest() }
                Toggle("A4 log contact impulses", isOn: $controller.spikes.logContacts)
                Picker("S7 spheres", selection: $controller.spikes.stressCount) {
                    Text("S7 off").tag(0)
                    Text("5k").tag(5000)
                    Text("10k").tag(10000)
                    Text("30k").tag(30000)
                }
                .pickerStyle(.segmented)
                Toggle("S8 rebuild the camera window every frame", isOn: $controller.spikes.s8EveryFrame)
                Picker("S8 window build", selection: $controller.spikes.s8Build) {
                    ForEach(S8Build.allCases) { build in
                        Text("S8 \(build.title)").tag(build)
                    }
                }
                .pickerStyle(.segmented)
                Button("S9 drop boxes and hulls of 3 and 90 cm") { controller.s9Drop() }
                Button("S10 time 1k and 2k atom meshes") { controller.timeMeshBuilds() }
                Divider().overlay(Color.white.opacity(0.3))
                // M4 (plan §8 M4): the thermal policy, spike A5, the flop and spike A6, the sound lab.
                Picker("Thermal", selection: $controller.spikes.thermal) {
                    Text("Thermal as is").tag(ThermalChoice.device)
                    Text("serious").tag(ThermalChoice.serious)
                    Text("critical").tag(ThermalChoice.critical)
                }
                .pickerStyle(.segmented)
                Toggle("A5 allow 30 fps at critical", isOn: $controller.spikes.a5ThirtyFPS)
                Button("A5 hold 30 fps / let go") { controller.a5Switch() }
                Toggle("A6 flexible molecules flop (drawn)", isOn: $controller.spikes.flop)
                Button("A6 toss the selected molecule beside a jointed copy") { controller.jointFlopTest() }
                Button("Sound lab") { showingSoundLab = true }
                lines(controller.a1Lines)
                lines(controller.spikeLines)
                lines(controller.contactLog)
            }
            .buttonStyle(.bordered)
            .padding(10)
        }
        .frame(maxHeight: 340)
        .font(.system(size: 11, design: .monospaced))
        .foregroundStyle(.white)
        .tint(Color.lime)
        .background(.black.opacity(0.65), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .sheet(isPresented: $showingSoundLab) {
            SoundLabView(controller: controller)
        }
    }

    private func lines(_ list: [String]) -> some View {
        ForEach(Array(list.enumerated()), id: \.offset) { _, line in
            Text(line)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
