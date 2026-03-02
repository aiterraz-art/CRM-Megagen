import ReactCanvasConfetti from 'react-canvas-confetti';
import { useCallback, useRef } from 'react';
import type { TCanvasConfettiInstance } from 'react-canvas-confetti/dist/types';

export type ConfettiBurstController = {
    celebrate: () => void;
};

export const useConfettiBurst = (): {
    refConfetti: (instance: TCanvasConfettiInstance) => void;
    celebrate: () => void;
} => {
    const confettiRef = useRef<TCanvasConfettiInstance | null>(null);

    const refConfetti = useCallback((instance: TCanvasConfettiInstance) => {
        confettiRef.current = instance;
    }, []);

    const celebrate = useCallback(() => {
        if (!confettiRef.current) return;
        confettiRef.current({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#4f46e5', '#10b981', '#f59e0b']
        });
    }, []);

    return { refConfetti, celebrate };
};

type ConfettiBurstProps = {
    onReady?: (controller: ConfettiBurstController) => void;
};

const ConfettiBurst = ({ onReady }: ConfettiBurstProps) => {
    const { refConfetti, celebrate } = useConfettiBurst();

    return (
        <ReactCanvasConfetti
            className="pointer-events-none fixed inset-0 z-[1400]"
            style={{ width: '100%', height: '100%' }}
            onInit={({ confetti }) => {
                refConfetti(confetti);
                onReady?.({ celebrate });
            }}
        />
    );
};

export default ConfettiBurst;
