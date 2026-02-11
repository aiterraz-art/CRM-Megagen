import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { X, ShoppingCart, Plus, Minus, Search, Trash2 } from 'lucide-react';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

interface Product {
    id: string;
    name: string;
    sku: string;
    price: number;
    stock_quantity: number;
    category: string;
}

interface OrderItem {
    product: Product;
    quantity: number;
}

interface OrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    visitId?: string; // Optional: If created from a visit
    clientId: string; // Required
    userId: string; // Required: Seller ID
    onOrderCreated?: () => void;
}

const OrderModal: React.FC<OrderModalProps> = ({ isOpen, onClose, visitId, clientId, userId, onOrderCreated }) => {
    const [products, setProducts] = useState<Product[]>([]);
    const [cart, setCart] = useState<OrderItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchProducts();
            setCart([]);
            setSearchTerm('');
        }
    }, [isOpen]);

    const fetchProducts = async () => {
        setLoading(true);
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .order('name');

        if (data) setProducts(data);
        setLoading(false);
    };

    const addToCart = (product: Product) => {
        setCart(prev => {
            const existing = prev.find(item => item.product.id === product.id);
            if (existing) {
                return prev.map(item =>
                    item.product.id === product.id
                        ? { ...item, quantity: item.quantity + 1 }
                        : item
                );
            }
            return [...prev, { product, quantity: 1 }];
        });
    };

    const removeFromCart = (productId: string) => {
        setCart(prev => prev.filter(item => item.product.id !== productId));
    };

    const updateQuantity = (productId: string, delta: number) => {
        setCart(prev => prev.map(item => {
            if (item.product.id === productId) {
                const newQty = Math.max(1, item.quantity + delta);
                return { ...item, quantity: newQty };
            }
            return item;
        }));
    };

    const totalAmount = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);

    const handleSaveOrder = async () => {
        if (cart.length === 0) return;
        setSaving(true);

        try {
            // 1. Create Order
            const { data: order, error: orderError } = await supabase
                .from('orders')
                .insert({
                    user_id: userId,
                    client_id: clientId,
                    visit_id: visitId || null,
                    total_amount: totalAmount,
                    status: 'completed'
                })
                .select()
                .single();

            if (orderError) throw orderError;

            // 2. Create Items
            const itemsToInsert = cart.map(item => ({
                order_id: order.id,
                product_id: item.product.id,
                quantity: item.quantity,
                unit_price: item.product.price,
                total_price: item.product.price * item.quantity
            }));

            const { error: itemsError } = await supabase
                .from('order_items')
                .insert(itemsToInsert);

            if (itemsError) throw itemsError;

            // 3. Update Inventory (Optional logic for later, but good practice)
            // For now, just decreasing stock not implemented to keep RLS simple.

            if (onOrderCreated) onOrderCreated();
            onClose();
            alert('¡Pedido creado exitosamente!');

        } catch (error) {
            console.error('Error creating order:', error);
            alert('Error al guardar el pedido.');
        } finally {
            setSaving(false);
        }
    };

    const filteredProducts = products.filter(p =>
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.sku?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
                {/* Header */}
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <div>
                        <h2 className="text-xl font-black text-gray-900 flex items-center">
                            <ShoppingCart className="mr-2 text-indigo-600" />
                            Nueva Venta
                        </h2>
                        <p className="text-xs text-gray-400 font-bold">Selecciona productos del inventario</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
                        <X size={20} className="text-gray-500" />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Product List (Left) */}
                    <div className="w-1/2 border-r border-gray-100 flex flex-col bg-gray-50/50">
                        <div className="p-4 border-b border-gray-100 bg-white">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                                <input
                                    type="text"
                                    placeholder="Buscar por nombre o SKU..."
                                    className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {loading ? (
                                <p className="text-center text-gray-400 py-8">Cargando inventario...</p>
                            ) : filteredProducts.length > 0 ? (
                                filteredProducts.map(product => (
                                    <div key={product.id} className="bg-white p-4 rounded-xl border border-gray-100 hover:border-indigo-300 transition-all cursor-pointer group shadow-sm hover:shadow-md" onClick={() => addToCart(product)}>
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="font-bold text-gray-800 group-hover:text-indigo-600 transition-colors">{product.name}</p>
                                                <p className="text-xs text-gray-400 font-medium">{product.sku} • Stock: {product.stock_quantity}</p>
                                            </div>
                                            <p className="font-black text-indigo-600">${product.price.toLocaleString()}</p>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <p className="text-center text-gray-400 py-8">No se encontraron productos.</p>
                            )}
                        </div>
                    </div>

                    {/* Cart (Right) */}
                    <div className="w-1/2 flex flex-col bg-white">
                        <div className="p-4 border-b border-gray-100">
                            <h3 className="font-black text-gray-800">Resumen del Pedido</h3>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4">
                            {cart.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-gray-400 opacity-50">
                                    <ShoppingCart size={48} className="mb-4" />
                                    <p className="text-sm font-bold">El carrito está vacío</p>
                                </div>
                            ) : (
                                cart.map(item => (
                                    <div key={item.product.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
                                        <div className="flex-1">
                                            <p className="font-bold text-sm text-gray-800 line-clamp-1">{item.product.name}</p>
                                            <p className="text-xs text-indigo-600 font-bold">${(item.product.price * item.quantity).toLocaleString()}</p>
                                        </div>
                                        <div className="flex items-center space-x-3 ml-4">
                                            <div className="flex items-center bg-white rounded-lg border border-gray-200 shadow-sm">
                                                <button onClick={() => updateQuantity(item.product.id, -1)} className="p-1 hover:bg-gray-100 rounded-l-lg transition-colors"><Minus size={14} /></button>
                                                <span className="w-8 text-center text-xs font-bold">{item.quantity}</span>
                                                <button onClick={() => updateQuantity(item.product.id, 1)} className="p-1 hover:bg-gray-100 rounded-r-lg transition-colors"><Plus size={14} /></button>
                                            </div>
                                            <button onClick={() => removeFromCart(item.product.id)} className="text-red-400 hover:text-red-600 transition-colors">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="p-6 bg-gray-50 border-t border-gray-100">
                            <div className="flex justify-between items-end mb-4">
                                <p className="text-sm text-gray-500 font-medium">Total a Pagar</p>
                                <p className="text-3xl font-black text-gray-900">${totalAmount.toLocaleString()}</p>
                            </div>
                            <button
                                onClick={handleSaveOrder}
                                disabled={cart.length === 0 || saving}
                                className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transform transition-all flex items-center justify-center ${cart.length === 0 || saving
                                        ? 'bg-gray-300 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-indigo-600 to-violet-600 hover:scale-[1.02] hover:shadow-indigo-500/30'
                                    }`}
                            >
                                {saving ? (
                                    <span className="animate-pulse">Guardando...</span>
                                ) : (
                                    <>
                                        <CheckCircle2 size={20} className="mr-2" />
                                        Confirmar Pedido
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Import needed for icon usage above. Wait, I imported CheckCircle2 inside button but didn't import it at top.
import { CheckCircle2 } from 'lucide-react';

export default OrderModal;
