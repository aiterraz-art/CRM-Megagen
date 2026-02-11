import { RadialBarChart, RadialBar, ResponsiveContainer, PolarAngleAxis } from 'recharts';

interface GoalProgressChartProps {
    current: number;
    target: number;
}

const GoalProgressChart = ({ current, target }: GoalProgressChartProps) => {
    const percentage = Math.min(100, Math.max(0, (current / target) * 100));

    // Create data with full circle background usually, but here we keep it simple
    const data = [
        {
            name: 'Meta',
            value: percentage,
            fill: percentage >= 100 ? '#10b981' : '#4f46e5',
        }
    ];

    return (
        <div className="relative w-full h-[250px] flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                    innerRadius="80%"
                    outerRadius="100%"
                    barSize={20}
                    data={data}
                    startAngle={90}
                    endAngle={-270}
                >
                    <PolarAngleAxis
                        type="number"
                        domain={[0, 100]}
                        angleAxisId={0}
                        tick={false}
                    />
                    <RadialBar
                        background
                        clockWise
                        dataKey="value"
                        cornerRadius={10}
                    />
                </RadialBarChart>
            </ResponsiveContainer>

            {/* Center Text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-4xl font-black text-gray-900">
                    {percentage.toFixed(0)}%
                </span>
                <span className="text-gray-400 text-xs font-bold uppercase tracking-wider mt-1">
                    De la Meta
                </span>
                <div className="mt-2 text-sm font-bold text-gray-500">
                    ${current.toLocaleString()} / ${target.toLocaleString()}
                </div>
            </div>
        </div>
    );
};

export default GoalProgressChart;
