import { createAudioPipeline, type AudioMetrics } from './audio';

const SUPPORTED_EXTENSIONS = new Set(['mp3', 'flac', 'wav']);

const isSupportedAudioFile = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    return SUPPORTED_EXTENSIONS.has(ext) || file.type.startsWith('audio/');
};

const formatSeconds = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const queryElement = <T extends HTMLElement>(selector: string): T => {
    const el = document.querySelector<T>(selector);
    if (!el) throw new Error(`Missing required DOM element: ${selector}`);
    return el;
};

type MeterPair = Readonly<{
    bar: HTMLDivElement;
    val: HTMLSpanElement;
}>;

const initApp = (): void => {
    const uploadInput = queryElement<HTMLInputElement>('#audio-upload');
    const dropOverlay = queryElement<HTMLDivElement>('#drop-overlay');
    const trackTitle = queryElement<HTMLParagraphElement>('#track-title');
    const trackTime = queryElement<HTMLSpanElement>('#track-time');
    const seekBar = queryElement<HTMLInputElement>('#seek-bar');
    const playPauseBtn = queryElement<HTMLButtonElement>('#play-pause-btn');

    const meters: Record<keyof AudioMetrics, MeterPair> = {
        bass: { bar: queryElement<HTMLDivElement>('#bar-bass'), val: queryElement<HTMLSpanElement>('#val-bass') },
        kick: { bar: queryElement<HTMLDivElement>('#bar-kick'), val: queryElement<HTMLSpanElement>('#val-kick') },
        mid: { bar: queryElement<HTMLDivElement>('#bar-mid'), val: queryElement<HTMLSpanElement>('#val-mid') },
        treble: { bar: queryElement<HTMLDivElement>('#bar-treble'), val: queryElement<HTMLSpanElement>('#val-treble') },
        rms: { bar: queryElement<HTMLDivElement>('#bar-rms'), val: queryElement<HTMLSpanElement>('#val-rms') },
        centroid: { bar: queryElement<HTMLDivElement>('#bar-centroid'), val: queryElement<HTMLSpanElement>('#val-centroid') },
        flux: { bar: queryElement<HTMLDivElement>('#bar-flux'), val: queryElement<HTMLSpanElement>('#val-flux') },
    };

    const pipeline = createAudioPipeline();
    let isScrubbing = false;

    const handleSelectedFile = async (file: File | undefined): Promise<void> => {
        if (!file) return;
        if (!isSupportedAudioFile(file)) {
            trackTitle.textContent = 'Unsupported format — use MP3, FLAC, or WAV';
            return;
        }

        trackTitle.textContent = file.name.replace(/\.[^/.]+$/, '');
        seekBar.disabled = false;
        playPauseBtn.disabled = false;

        await pipeline.loadFile(file);
    };

    uploadInput.addEventListener('change', () => {
        void handleSelectedFile(uploadInput.files?.[0]);
    });

    let dragDepth = 0;

    window.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragDepth++;
        dropOverlay.classList.remove('opacity-0');
    });

    window.addEventListener('dragleave', () => {
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) dropOverlay.classList.add('opacity-0');
    });

    window.addEventListener('dragover', (e) => e.preventDefault());

    window.addEventListener('drop', (e) => {
        e.preventDefault();
        dragDepth = 0;
        dropOverlay.classList.add('opacity-0');
        void handleSelectedFile(e.dataTransfer?.files[0]);
    });

    playPauseBtn.addEventListener('click', () => {
        void pipeline.togglePlayback();
    });

    pipeline.audioElement.addEventListener('play', () => {
        playPauseBtn.textContent = 'Pause';
    });

    pipeline.audioElement.addEventListener('pause', () => {
        playPauseBtn.textContent = 'Play';
    });

    pipeline.audioElement.addEventListener('ended', () => {
        playPauseBtn.textContent = 'Play';
    });

    seekBar.addEventListener('pointerdown', () => {
        isScrubbing = true;
    });

    seekBar.addEventListener('input', () => {
        pipeline.seekToRatio(Number(seekBar.value) / 100);
    });

    window.addEventListener('pointerup', () => {
        isScrubbing = false;
    });

    const renderMeters = (metrics: AudioMetrics): void => {
        (Object.keys(meters) as Array<keyof AudioMetrics>).forEach((key) => {
            const value = metrics[key];
            meters[key].bar.style.width = `${Math.min(100, value * 100).toFixed(1)}%`;
            meters[key].val.textContent = value.toFixed(2);
        });
    };

    const tick = (): void => {
        const metrics = pipeline.sampleMetrics();
        renderMeters(metrics);

        const { currentTime, duration } = pipeline.audioElement;
        if (!isScrubbing && Number.isFinite(duration) && duration > 0) {
            seekBar.value = ((currentTime / duration) * 100).toFixed(2);
        }
        trackTime.textContent = `${formatSeconds(currentTime)} / ${formatSeconds(duration)}`;

        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
};

initApp();