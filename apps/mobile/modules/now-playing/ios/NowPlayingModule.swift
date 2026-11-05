import AVFoundation
import ExpoModulesCore
import MediaPlayer

/// 锁屏、控制中心的「正在播放」，以及锁屏按钮、耳机线控、AirPods 发来的命令（README 第 8 节「听书」）。
/// 朗读本身由 expo-speech 的 AVSpeechSynthesizer 完成，这里只负责展示和把命令转给 JS
public class NowPlayingModule: Module {
  private var targets: [(MPRemoteCommand, Any)] = []
  private var observers: [NSObjectProtocol] = []
  private var artworkUri: String?
  private var artwork: MPMediaItemArtwork?

  public func definition() -> ModuleDefinition {
    Name("NowPlaying")

    /// command：play / pause / toggle / next / previous；
    /// interrupted（来电等打断开始）/ resumable（打断结束，系统建议恢复）/ unplugged（耳机拔出）
    Events("onCommand")

    AsyncFunction("update") { (info: NowPlayingInfo) in
      self.enableCommands()
      var dict: [String: Any] = [
        MPMediaItemPropertyTitle: info.title,
        MPMediaItemPropertyArtist: info.artist,
        // 没有时长：锁屏不显示进度条和剩余时间
        MPNowPlayingInfoPropertyPlaybackRate: info.playing ? 1.0 : 0.0,
        MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
      ]
      if let art = self.loadArtwork(info.artwork) {
        dict[MPMediaItemPropertyArtwork] = art
      }
      MPNowPlayingInfoCenter.default().nowPlayingInfo = dict
    }
    .runOnQueue(.main)

    AsyncFunction("clear") {
      self.disableCommands()
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
    .runOnQueue(.main)

    OnCreate {
      self.observeSession()
    }

    OnDestroy {
      self.observers.forEach { NotificationCenter.default.removeObserver($0) }
      self.observers.removeAll()
      DispatchQueue.main.async { self.disableCommands() }
    }
  }

  private func emit(_ command: String) {
    sendEvent("onCommand", ["command": command])
  }

  private func enableCommands() {
    guard targets.isEmpty else { return }
    let center = MPRemoteCommandCenter.shared()
    let map: [(MPRemoteCommand, String)] = [
      (center.playCommand, "play"),
      (center.pauseCommand, "pause"),
      (center.togglePlayPauseCommand, "toggle"),
      // 锁屏的上一首 / 下一首、AirPods 双击 / 三击：按段落跳
      (center.nextTrackCommand, "next"),
      (center.previousTrackCommand, "previous"),
    ]
    for (command, name) in map {
      command.isEnabled = true
      let target = command.addTarget { [weak self] _ in
        self?.emit(name)
        return .success
      }
      targets.append((command, target))
    }
    // 没有时长，不提供快进快退和拖动进度
    center.skipForwardCommand.isEnabled = false
    center.skipBackwardCommand.isEnabled = false
    center.changePlaybackPositionCommand.isEnabled = false
  }

  private func disableCommands() {
    for (command, target) in targets {
      command.removeTarget(target)
      command.isEnabled = false
    }
    targets.removeAll()
  }

  private func observeSession() {
    let session = AVAudioSession.sharedInstance()
    let center = NotificationCenter.default
    observers.append(
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        switch type {
        case .began:
          self?.emit("interrupted")
        case .ended:
          let raw = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
          if AVAudioSession.InterruptionOptions(rawValue: raw).contains(.shouldResume) { self?.emit("resumable") }
        @unknown default:
          break
        }
      })
    observers.append(
      center.addObserver(forName: AVAudioSession.routeChangeNotification, object: session, queue: .main) { [weak self] note in
        guard let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
          AVAudioSession.RouteChangeReason(rawValue: raw) == .oldDeviceUnavailable
        else { return }
        // 跑步时耳机掉了，不要改从扬声器外放
        self?.emit("unplugged")
      })
  }

  private func loadArtwork(_ uri: String?) -> MPMediaItemArtwork? {
    guard let uri else {
      artworkUri = nil
      artwork = nil
      return nil
    }
    if uri == artworkUri { return artwork }
    artworkUri = uri
    artwork = nil
    guard let url = URL(string: uri), let image = UIImage(contentsOfFile: url.path) else { return nil }
    artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
    return artwork
  }
}

struct NowPlayingInfo: Record {
  /// 章节名
  @Field var title: String = ""
  /// 书名
  @Field var artist: String = ""
  /// 封面 cover.png 的 file:// URL
  @Field var artwork: String?
  @Field var playing: Bool = true
}
