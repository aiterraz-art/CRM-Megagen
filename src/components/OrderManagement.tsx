import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { Search, ShoppingCart, Plus, Minus, Check, Filter, Package } from 'lucide-react';
import { Database } from '../types/supabase';

type InventoryItem = Database['public']['Tables']['inventory']['Row'];

interface OrderItem extends InventoryItem {
    qty: number;
}

const OrderManagement = ({ visitId, onComplete }: { visitId: string, onComplete: () => void }) => {
    const [items, setItems] = useState<InventoryItem[]>([]);
    const [search, setSearch] = useState('');
    const [cart, setCart] = useState<OrderItem[]>([]);
    const [discount, setDiscount] = useState(0);

    useEffect(() => {
        const fetchInventory = async () => {
            const { data } = await (supabase.from('inventory') as any).select('*');
            if (data) setItems(data as any as InventoryItem[]);
        };
        fetchInventory();
    }, []);

    const addToCart = (item: InventoryItem) => {
        setCart(prev => {
            const existing = prev.find(i => i.id === item.id);
            if (existing) {
                return prev.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i);
            }
            return [...prev, { ...item, qty: 1 }];
        });
    };

    const removeFromCart = (itemId: string) => {
        setCart(prev => prev.map(i => i.id === itemId ? { ...i, qty: Math.max(0, i.qty - 1) } : i).filter(i => i.qty > 0));
    };

    const total = cart.reduce((acc, item) => acc + (item.price || 0) * item.qty, 0);
    const tax = total * 0.08;
    const finalTotal = (total + tax) * (1 - discount / 100);

    const handleSubmitOrder = async () => {
        const status = discount > 10 ? 'pending' : 'approved';
        const { error } = await (supabase.from('orders') as any).insert({
            visit_id: visitId,
            items: cart,
            total_amount: finalTotal,
            total_discount: discount,
            status: status
        });

        if (!error) {
            const body = `Order Confirmation for ${visitId}\n\nClient: Bright Smile Clinic\nTotal: $${finalTotal.toFixed(2)}\n\nItems Detail:\n${cart.map(i => `- ${i.name} (x${i.qty})`).join('\n')}\n\nPlease proceed with the processing.`;
            const mailto = `mailto:sales@dentaltech.com?subject=New Order - ${visitId}&body=${encodeURIComponent(body)}`;

            if (status === 'pending') {
                alert("Order requires supervisor approval due to >10% discount.");
            }
            window.location.href = mailto;
            onComplete();
        }
    };

    return (
        <div className="flex h-full gap-8">
            <div className="flex-1 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-3xl font-extrabold text-gray-900">Product Catalog</h2>
                        <p className="text-gray-400 font-medium">Browse and manage dental supplies</p>
                    </div>
                    <div className="flex items-center space-x-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                            <input
                                type="text"
                                placeholder="Search instruments..."
                                className="pl-10 pr-4 py-3 bg-white border border-transparent rounded-2xl shadow-sm focus:ring-2 focus:ring-dental-500 outline-none w-64"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                        <button className="p-3 bg-white rounded-xl border border-gray-100 text-gray-400">
                            <Filter size={20} />
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 overflow-y-auto max-h-[calc(100vh-300px)] pr-2">
                    {items.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).map(item => (
                        <div key={item.id} className="premium-card p-4 space-y-4 group">
                            <div className="aspect-square bg-gray-50 rounded-[1.5rem] relative overflow-hidden flex items-center justify-center border border-gray-100">
                                {item.stock_qty && item.stock_qty < 5 && (
                                    <span className="absolute top-3 left-3 bg-orange-50 text-orange-600 text-[9px] font-bold uppercase px-2 py-1 rounded-md border border-orange-100 z-10">
                                        Low Stock
                                    </span>
                                )}
                                <Package size={48} className="text-gray-200 group-hover:scale-110 transition-transform duration-500" />
                                <button
                                    onClick={() => addToCart(item)}
                                    className="absolute bottom-3 right-3 premium-btn-accent !py-2 !px-4 !rounded-xl opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition-all flex items-center text-xs"
                                >
                                    <Plus size={14} className="mr-1" /> Quick Add
                                </button>
                            </div>
                            <div>
                                <h4 className="font-bold text-gray-900 text-sm truncate">{item.name}</h4>
                                <p className="text-[10px] text-gray-400 font-medium uppercase mt-1">Instrument Set</p>
                                <p className="mt-2 text-lg font-extrabold text-gray-900">${item.price}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Cart Sidebar (Matching Image 3) */}
            <div className="w-80 bg-white rounded-[2.5rem] shadow-xl border border-gray-100 flex flex-col overflow-hidden">
                <div className="p-6 border-b border-gray-50 flex items-center justify-between">
                    <div>
                        <h3 className="font-bold text-gray-900">Current Order</h3>
                        <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Bright Smile Clinic</p>
                    </div>
                    <div className="p-3 bg-dental-50 text-dental-600 rounded-2xl relative">
                        <ShoppingCart size={20} />
                        <span className="absolute -top-1 -right-1 bg-dental-600 text-white text-[10px] w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">{cart.length}</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {cart.map(item => (
                        <div key={item.id} className="flex items-center space-x-3 group">
                            <div className="w-12 h-12 bg-gray-50 rounded-xl overflow-hidden flex items-center justify-center border border-gray-100">
                                <Package size={18} className="text-gray-300" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-gray-900 truncate">{item.name}</p>
                                <p className="text-[10px] text-gray-400">Qty: {item.qty}</p>
                            </div>
                            <p className="text-xs font-bold text-gray-900">${(item.price || 0) * item.qty}</p>
                        </div>
                    ))}
                </div>

                <div className="p-6 bg-gray-50 space-y-3">
                    <div className="flex justify-between text-xs font-medium text-gray-500">
                        <span>Subtotal</span>
                        <span>${total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs font-medium text-gray-500">
                        <span>Tax (8%)</span>
                        <span>${tax.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-end pt-2">
                        <span className="text-xs font-bold text-gray-900">Total Order</span>
                        <span className="text-2xl font-black text-dental-600">${finalTotal.toFixed(2)}</span>
                    </div>
                    <button
                        onClick={handleSubmitOrder}
                        disabled={cart.length === 0}
                        className="w-full bg-dental-500 hover:bg-dental-600 text-white py-4 rounded-2xl font-bold mt-4 shadow-xl shadow-dental-100 transition-all active:scale-95 disabled:opacity-50"
                    >
                        Submit for Approval
                    </button>
                    <p className="text-[9px] text-gray-400 text-center font-bold uppercase tracking-widest mt-2">Requires Clinic Manager Signature</p>
                </div>
            </div>
        </div>
    );
};

export default OrderManagement;
