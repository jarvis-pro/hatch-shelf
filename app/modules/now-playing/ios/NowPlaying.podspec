Pod::Spec.new do |s|
  s.name           = 'NowPlaying'
  s.version        = '1.0.0'
  s.summary        = '听书的锁屏「正在播放」与耳机、锁屏控制'
  s.description    = '听书的锁屏「正在播放」与耳机、锁屏控制'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
