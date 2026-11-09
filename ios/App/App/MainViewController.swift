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
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        guard let launch = UIStoryboard(name: "LaunchScreen", bundle: nil).instantiateInitialViewController()?.view else { return }
        launch.frame = view.bounds
        launch.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(launch)
        cover = launch
        // Sound after coming back from the background: iOS can hold the web view's audio for several seconds. Mix
        // with other apps' audio and respect the silent switch (as Web Audio does), and reactivate it ourselves on return.
        try? AVAudioSession.sharedInstance().setCategory(.ambient)
        NotificationCenter.default.addObserver(self, selector: #selector(appBecameActive),
                                               name: UIApplication.didBecomeActiveNotification, object: nil)
        // never leave it up if the page doesn't call hide() (an error, or an older web bundle)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in self?.hideCover() }
    }

    @objc private func appBecameActive() {
        try? AVAudioSession.sharedInstance().setActive(true)
        webView?.evaluateJavaScript("window.__shengjiAudioNudge && window.__shengjiAudioNudge()")
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
