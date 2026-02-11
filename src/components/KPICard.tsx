import { LucideIcon } from 'lucide-react';

interface KPICardProps {
    title: string;
    value: string | number;
    icon: LucideIcon;
    trend?: string;
    trendUp?: boolean;
    color: 'indigo' | 'emerald' | 'amber' | 'blue' | 'rose';
}

const KPICard = ({ title, value, icon: Icon, trend, trendUp, color }: KPICardProps) => {
    const colorStyles = {
        indigo: 'text-indigo-600 bg-indigo-50 border-indigo-100',
        emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
        amber: 'text-amber-600 bg-amber-50 border-amber-100',
        blue: 'text-blue-600 bg-blue-50 border-blue-100',
        rose: 'text-rose-600 bg-rose-50 border-rose-100',
    };

    const borderColors = {
        indigo: 'border-l-indigo-600',
        emerald: 'border-l-emerald-600',
        amber: 'border-l-amber-600',
        blue: 'border-l-blue-600',
        rose: 'border-l-rose-600',
    };

    return (
        <div className={`premium-card p-6 border-l-4 ${borderColors[color]}`}>
            <div className="flex justify-between items-start">
                <div>
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-2 ${colorStyles[color].split(' ')[0]}`}>
                        {title}
                    </p>
                    <p className="text-3xl font-black text-gray-900 tracking-tight">
                        {value}
                    </p>
                </div>
                <div className={`p-3 rounded-xl ${colorStyles[color]}`}>
                    <Icon size={24} strokeWidth={2.5} />
                </div>
            </div>

            {trend && (
                <div className={`mt-4 flex items-center text-xs font-bold ${trendUp ? 'text-emerald-600' : 'text-rose-500'}`}>
                    {trendUp ? '↑' : '↓'} {trend}
                    <span className="text-gray-400 font-medium ml-2 uppercase tracking-wide">vs mes anterior</span>
                </div>
            )}
        </div>
    );
};

export default KPICard;
