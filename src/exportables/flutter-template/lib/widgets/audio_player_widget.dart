import 'package:flutter/material.dart';
import 'package:just_audio/just_audio.dart';
import 'package:rxdart/rxdart.dart';
import 'package:audio_video_progress_bar/audio_video_progress_bar.dart';

class AudioPlayerWidget extends StatefulWidget {
  final String url;

  const AudioPlayerWidget({super.key, required this.url});

  @override
  State<AudioPlayerWidget> createState() => _AudioPlayerWidgetState();
}

class _AudioPlayerWidgetState extends State<AudioPlayerWidget> {
  late AudioPlayer _player;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    _player = AudioPlayer();
    _loadAudio();
  }

  Future<void> _loadAudio() async {
    try {
      await _player.setUrl(widget.url);
      setState(() {
        _ready = true;
      });
    } catch (e) {
      print("Error loading audio: $e");
    }
  }

  @override
  void dispose() {
    _player.dispose();
    super.dispose();
  }

  Stream<PositionData> get _positionDataStream =>
      Rx.combineLatest3<Duration, Duration?, Duration, PositionData>(
        _player.positionStream,
        _player.durationStream,
        _player.bufferedPositionStream,
        (position, duration, buffered) =>
            PositionData(position, duration ?? Duration.zero, buffered),
      );

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final height = constraints.maxHeight;
        final width = constraints.maxWidth;

        final barHeight = height * 0.2;
        final iconSize = height * 0.3;
        final spacing = height * 0.05;

        return Container(
          width: width,
          height: height,
          padding: EdgeInsets.symmetric(horizontal: width * 0.05),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              StreamBuilder<PositionData>(
                stream: _positionDataStream,
                builder: (context, snapshot) {
                  final data = snapshot.data ??
                      PositionData(Duration.zero, Duration.zero, Duration.zero);

                  return SizedBox(
                    height: barHeight,
                    child: ProgressBar(
                      progress: data.position,
                      total: data.duration,
                      buffered: data.buffered,
                      onSeek: _ready ? _player.seek : null,
                    ),
                  );
                },
              ),
              SizedBox(height: spacing),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  IconButton(
                    iconSize: iconSize,
                    icon: const Icon(Icons.play_arrow),
                    onPressed: () => _player.play(),
                  ),
                  IconButton(
                    iconSize: iconSize,
                    icon: const Icon(Icons.pause),
                    onPressed: () => _player.pause(),
                  ),
                ],
              )
            ],
          ),
        );
      },
    );
  }
}

class PositionData {
  final Duration position;
  final Duration duration;
  final Duration buffered;

  PositionData(this.position, this.duration, this.buffered);
}
