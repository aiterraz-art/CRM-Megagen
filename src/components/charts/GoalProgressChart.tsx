interface GoalProgressChartProps {
    current: number;
    target: number;
}

const GoalProgressChart = ({ current, target }: GoalProgressChartProps) => {
    const safeTarget = Math.max(Number(target) || 0, 1);
    const safeCurrent = Math.max(Number(current) || 0, 0);
    const percentage = Math.min(100, Math.max(0, (safeCurrent / safeTarget) * 100));

    const size = 220;
    const strokeWidth = 18;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const progressOffset = circumference - (percentage / 100) * circumference;
    const progressColor = percentage >= 100 ? '#10b981' : '#4f46e5';

    return (
        <div className="relative w-full h-[250px] flex items-center justify-center">
            <svg
                viewBox={`0 0 ${size} ${size}`}
                className="h-full w-full max-w-[250px] -rotate-90"
                aria-label={`Avance de meta ${percentage.toFixed(0)} por ciento`}
                role="img"
            >
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke="#e5e7eb"
                    strokeWidth={strokeWidth}
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={progressColor}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={progressOffset}
                    className="transition-all duration-500 ease-out"
                />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-4xl font-black text-gray-900">
                    {percentage.toFixed(0)}%
                </span>
                <span className="text-gray-400 text-xs font-bold uppercase tracking-wider mt-1">
                    De la Meta
                </span>
                <div className="mt-2 text-sm font-bold text-gray-500">
                    ${safeCurrent.toLocaleString()} / ${safeTarget.toLocaleString()}
                </div>
            </div>
        </div>
    );
};

export default GoalProgressChart;
