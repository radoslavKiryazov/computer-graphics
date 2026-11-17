export type AudioMetrics = {
    bass: number;
    mid: number;
    treble: number;
    kick: number;
    rms: number;
    centroid: number;
    flux: number;
};

export type AudioPipeline = {
    audioElement: HTMLAudioElement;
    loadFile: (file: File) => Promise<void>;
    togglePlayback: () => Promise<void>;
    seekToRatio: (ratio: number) => void;
    sampleMetrics: () => AudioMetrics;
};

type GraphNodes = Readonly<{
    ctx: AudioContext;
    analyser: AnalyserNode;
    freqData: Uint8Array<ArrayBuffer>;
    prevFreqData: Uint8Array<ArrayBuffer>;
    timeData: Uint8Array<ArrayBuffer>;
}>;

const ZERO_METRICS: AudioMetrics = {
    bass: 0,
    mid: 0,
    treble: 0,
    kick: 0,
    rms: 0,
    centroid: 0,
    flux: 0,
};

const computeBandAverage = (
    bins: Uint8Array<ArrayBuffer>,
    startBin: number,
    endBin: number
): number => {
    const clampedEnd = Math.min(endBin, bins.length - 1);
    if (clampedEnd < startBin) return 0;

    let sum = 0;
    for (let i = startBin; i <= clampedEnd; i++) {
        sum += bins[i];
    }
    return sum / ((clampedEnd - startBin + 1) * 255);
};

const computeRms = (timeBins: Uint8Array<ArrayBuffer>): number => {
    let sumSquares = 0;
    for (let i = 0; i < timeBins.length; i++) {
        const normalized = (timeBins[i] - 128) / 128;
        sumSquares += normalized * normalized;
    }
    return Math.min(1, Math.sqrt(sumSquares / timeBins.length) * 2.5);
};

const computeSpectralFeatures = (
    bins: Uint8Array<ArrayBuffer>,
    prevBins: Uint8Array<ArrayBuffer>
): { centroid: number; flux: number } => {
    let weightedSum = 0;
    let totalEnergy = 0;
    let positiveFlux = 0;

    // Cap at ~16 kHz (bin ~745 at 44.1 kHz / 2048 FFT) to ignore dead ultrasonic bins
    const maxBin = Math.min(745, bins.length - 1);

    for (let i = 1; i <= maxBin; i++) {
        const mag = bins[i] / 255;
        const prevMag = prevBins[i] / 255;

        weightedSum += i * mag;
        totalEnergy += mag;
        positiveFlux += Math.max(0, mag - prevMag);
    }

    prevBins.set(bins);

    const centroid = totalEnergy > 0.001 ? weightedSum / (totalEnergy * maxBin) : 0;
    const flux = Math.min(1, positiveFlux / 18);

    return { centroid, flux };
};

export const createAudioPipeline = (): AudioPipeline => {
    const audioElement = new Audio();
    audioElement.crossOrigin = 'anonymous';

    let graph: GraphNodes | null = null;
    let activeObjectUrl: string | null = null;
    let prevBass = 0;

    const ensureAudioGraph = (): GraphNodes => {
        if (graph) return graph;

        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048; // 1024 bins (~21.5 Hz per bin at 44.1 kHz)
        analyser.smoothingTimeConstant = 0.8;

        const source = ctx.createMediaElementSource(audioElement);
        source.connect(analyser);
        analyser.connect(ctx.destination);

        const binCount = analyser.frequencyBinCount;
        const freqData = new Uint8Array(new ArrayBuffer(binCount));
        const prevFreqData = new Uint8Array(new ArrayBuffer(binCount));
        const timeData = new Uint8Array(new ArrayBuffer(analyser.fftSize));

        graph = Object.freeze({ ctx, analyser, freqData, prevFreqData, timeData });
        return graph;
    };

    const loadFile = async (file: File): Promise<void> => {
        if (activeObjectUrl) {
            URL.revokeObjectURL(activeObjectUrl);
        }

        activeObjectUrl = URL.createObjectURL(file);
        audioElement.src = activeObjectUrl;
        prevBass = 0;

        const nodes = ensureAudioGraph();
        nodes.prevFreqData.fill(0);

        if (nodes.ctx.state === 'suspended') {
            await nodes.ctx.resume();
        }

        await audioElement.play();
    };

    const togglePlayback = async (): Promise<void> => {
        if (!audioElement.src) return;

        if (graph?.ctx.state === 'suspended') {
            await graph.ctx.resume();
        }

        if (audioElement.paused) {
            await audioElement.play();
        } else {
            audioElement.pause();
        }
    };

    const seekToRatio = (ratio: number): void => {
        if (!Number.isFinite(audioElement.duration) || audioElement.duration <= 0) return;
        const clamped = Math.max(0, Math.min(1, ratio));
        audioElement.currentTime = clamped * audioElement.duration;
    };

    const sampleMetrics = (): AudioMetrics => {
        if (!graph || audioElement.paused) return ZERO_METRICS;

        graph.analyser.getByteFrequencyData(graph.freqData);
        graph.analyser.getByteTimeDomainData(graph.timeData);

        const bass = computeBandAverage(graph.freqData, 1, 6);       // ~20–130 Hz
        const mid = computeBandAverage(graph.freqData, 12, 93);      // ~250–2,000 Hz
        const treble = computeBandAverage(graph.freqData, 185, 550); // ~4,000–12,000 Hz

        const kick = Math.max(0, bass - prevBass);
        prevBass = bass * 0.85 + prevBass * 0.15;

        const rms = computeRms(graph.timeData);
        const { centroid, flux } = computeSpectralFeatures(graph.freqData, graph.prevFreqData);

        return { bass, mid, treble, kick, rms, centroid, flux };
    };

    return Object.freeze({
        audioElement,
        loadFile,
        togglePlayback,
        seekToRatio,
        sampleMetrics,
    });
};