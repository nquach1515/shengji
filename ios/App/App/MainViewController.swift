import UIKit
import AVFoundation
import Capacitor

/// Keeps the launch screen over the web view until the game has drawn the same logo underneath it
/// (src/ui/LaunchIntro.tsx calls LaunchCover.hide()), so the logo can move into the home screen without blinking.
/// Without this, the dark web view shows for a moment between the launch screen and the first paint.
class MainViewController: CAPBridgeViewController {
    private var cover: UIView?

    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LaunchCoverPlugin())
        bridge?.registerPluginInstance(NativeSoundPlugin())
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let launch = UIStoryboard(name: "LaunchScreen", bundle: nil).instantiateInitialViewController()?.view else { return }
        launch.frame = view.bounds
        launch.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(launch)
        cover = launch
        // Game sounds play natively (NativeSoundPlugin): mix with other apps' audio and follow the silent switch, as
        // web audio did; the session is on only while the app is in front.
        try? AVAudioSession.sharedInstance().setCategory(.ambient)
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appWillResign),
                                               name: UIApplication.willResignActiveNotification, object: nil)
        // never leave it up if the page doesn't call hide() (an error, or an older web bundle)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.hideCover() }
    }

    @objc private func appBecameActive() {
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    @objc private func appWillResign() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func hideCover() {
        cover?.removeFromSuperview()
        cover = nil
    }
}

@objc(LaunchCoverPlugin)
class LaunchCoverPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "LaunchCoverPlugin"
    let jsName = "LaunchCover"
    let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise)]

    @objc func hide(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            (self.bridge?.viewController as? MainViewController)?.hideCover()
            call.resolve()
        }
    }
}

/// Plays the game's sounds natively. The page renders each sound to WAV once at startup (src/ui/nativeSound.ts) and
/// loads them here; WebKit holds web audio for seconds after the app returns from the background, native audio isn't.
@objc(NativeSoundPlugin)
class NativeSoundPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "NativeSoundPlugin"
    let jsName = "NativeSound"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnNone),
    ]
    private var sounds: [String: [Data]] = [:]
    private var playing: [AVAudioPlayer] = []

    @objc func load(_ call: CAPPluginCall) {
        guard let obj = call.getObject("sounds") else { return call.reject("no sounds") }
        var loaded: [String: [Data]] = [:]
        for (name, takes) in obj {
            loaded[name] = (takes as? [String] ?? []).compactMap { Data(base64Encoded: $0) }
        }
        DispatchQueue.main.async {
            self.sounds = loaded
            call.resolve()
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        guard let name = call.getString("name") else { return }
        DispatchQueue.main.async {
            guard let data = self.sounds[name]?.randomElement(), let player = try? AVAudioPlayer(data: data) else { return }
            self.playing.removeAll { !$0.isPlaying } // finished ones
            self.playing.append(player)
            player.play()
        }
    }
}
