/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                dental: {
                    50: '#f5f3ff',
                    100: '#ede9fe',
                    200: '#ddd6fe',
                    300: '#c4b5fd',
                    400: '#a78bfa',
                    500: '#8b5cf6', // Primary Purple
                    600: '#7c3aed',
                    700: '#6d28d9',
                    800: '#5b21b6',
                    900: '#4c1d95',
                },
                premium: {
                    sidebar: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    accent: '#14b8a6', // Teal
                    warning: '#f97316', // Orange/Coral
                    overdue: '#ef4444',
                    bg: '#f8fafc',
                }
            },
            borderRadius: {
                '3xl': '1.5rem',
                '4xl': '2rem',
            },
            animation: {
                'bounce-slow': 'bounce 3s infinite',
            },
            backgroundImage: {
                'side-gradient': 'linear-gradient(180deg, #6366f1 0%, #a855f7 100%)',
            }
        },
    },
    plugins: [],
}
