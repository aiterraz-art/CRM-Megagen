export type Json =
    | string
    | number
    | boolean
    | null
    | { [key: string]: Json | undefined }
    | Json[]

export interface Database {
    public: {
        Tables: {
            clients: {
                Row: {
                    address: string | null
                    id: string
                    lat: number | null
                    last_visit_date: string | null
                    lng: number | null
                    name: string
                    purchase_contact: string | null
                    status: string | null
                    zone: string | null
                    created_by: string | null
                    rut: string | null
                    phone: string | null
                    email: string | null
                    notes: string | null
                    giro: string | null
                    comuna: string | null
                }
                Insert: {
                    address?: string | null
                    id?: string
                    lat?: number | null
                    last_visit_date?: string | null
                    lng?: number | null
                    name: string
                    purchase_contact?: string | null
                    status?: string | null
                    zone?: string | null
                    rut?: string | null
                    phone?: string | null
                    email?: string | null
                    notes?: string | null
                    giro?: string | null
                    comuna?: string | null
                }
                Update: {
                    address?: string | null
                    id?: string
                    lat?: number | null
                    last_visit_date?: string | null
                    lng?: number | null
                    name?: string
                    purchase_contact?: string | null
                    status?: string | null
                    zone?: string | null
                    rut?: string | null
                    phone?: string | null
                    email?: string | null
                    notes?: string | null
                    giro?: string | null
                    comuna?: string | null
                }
            }
            inventory: {
                Row: {
                    category: string | null
                    demo_available: boolean | null
                    id: string
                    name: string
                    price: number | null
                    stock_qty: number | null
                }
                Insert: {
                    category?: string | null
                    demo_available?: boolean | null
                    id?: string
                    name: string
                    price?: number | null
                    stock_qty?: number | null
                }
                Update: {
                    category?: string | null
                    demo_available?: boolean | null
                    id?: string
                    name?: string
                    price?: number | null
                    stock_qty?: number | null
                }
            }
            profiles: {
                Row: {
                    email: string | null
                    id: string
                    role: string | null
                    zone: string | null
                    status: string | null
                    full_name: string | null
                }
                Insert: {
                    email?: string | null
                    id: string
                    role?: string | null
                    zone?: string | null
                    status?: string | null
                    full_name?: string | null
                }
                Update: {
                    email?: string | null
                    id?: string
                    role?: string | null
                    zone?: string | null
                    status?: string | null
                    full_name?: string | null
                }
            }
            visits: {
                Row: {
                    check_in_time: string | null
                    check_out_time: string | null
                    check_out_lat: number | null
                    check_out_lng: number | null
                    client_id: string | null
                    id: string
                    lat: number | null
                    lng: number | null
                    notes: string | null
                    outcome: string | null
                    sales_rep_id: string | null
                    type: string | null
                    status: string | null
                }
                Insert: {
                    check_in_time?: string | null
                    check_out_time?: string | null
                    check_out_lat?: number | null
                    check_out_lng?: number | null
                    client_id?: string | null
                    id?: string
                    lat?: number | null
                    lng?: number | null
                    notes?: string | null
                    outcome?: string | null
                    sales_rep_id?: string | null
                    type?: string | null
                    status?: string | null
                }
                Update: {
                    check_in_time?: string | null
                    check_out_time?: string | null
                    check_out_lat?: number | null
                    check_out_lng?: number | null
                    client_id?: string | null
                    id?: string
                    lat?: number | null
                    lng?: number | null
                    notes?: string | null
                    outcome?: string | null
                    sales_rep_id?: string | null
                    type?: string | null
                    status?: string | null
                }
            }
            delivery_routes: {
                Row: {
                    id: string
                    name: string
                    driver_id: string | null
                    status: string
                    created_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    driver_id?: string | null
                    status?: string
                    created_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    driver_id?: string | null
                    status?: string
                    created_at?: string
                }
            }
            orders: {
                Row: {
                    id: string
                    items: Json | null
                    status: string | null
                    total_amount: number | null
                    total_discount: number | null
                    visit_id: string | null
                    interaction_type: string | null
                    delivery_status: string | null
                    delivery_photo_url: string | null
                    delivered_at: string | null
                    route_id: string | null
                }
                Insert: {
                    id?: string
                    items?: Json | null
                    status?: string | null
                    total_amount?: number | null
                    total_discount?: number | null
                    visit_id?: string | null
                    delivery_status?: string | null
                    delivery_photo_url?: string | null
                    delivered_at?: string | null
                    route_id?: string | null
                }
                Update: {
                    id?: string
                    items?: Json | null
                    status?: string | null
                    total_amount?: number | null
                    total_discount?: number | null
                    visit_id?: string | null
                    delivery_status?: string | null
                    delivery_photo_url?: string | null
                    delivered_at?: string | null
                    route_id?: string | null
                }
            }
            installed_base: {
                Row: {
                    client_id: string | null
                    id: string
                    machine_type: string | null
                    serial_number: string | null
                    warranty_end_date: string | null
                }
                Insert: {
                    client_id?: string | null
                    id?: string
                    machine_type?: string | null
                    serial_number?: string | null
                    warranty_end_date?: string | null
                }
                Update: {
                    client_id?: string | null
                    id?: string
                    machine_type?: string | null
                    serial_number?: string | null
                    warranty_end_date?: string | null
                }
            }
            tasks: {
                Row: {
                    assigned_to: string | null
                    assigned_by: string | null
                    client_id: string | null
                    created_at: string | null
                    description: string | null
                    due_date: string | null
                    id: string
                    status: string | null
                    title: string
                }
                Insert: {
                    assigned_to?: string | null
                    assigned_by?: string | null
                    client_id?: string | null
                    created_at?: string | null
                    description?: string | null
                    due_date?: string | null
                    id?: string
                    status?: string | null
                    title: string
                }
                Update: {
                    assigned_to?: string | null
                    assigned_by?: string | null
                    client_id?: string | null
                    created_at?: string | null
                    description?: string | null
                    due_date?: string | null
                    id?: string
                    status?: string | null
                    title?: string
                }
            }
            quotations: {
                Row: {
                    id: string
                    client_id: string | null
                    seller_id: string | null
                    items: Json | null
                    total_amount: number | null
                    payment_terms: Json | null
                    status: string | null
                    folio: number | null
                    comments: string | null
                    interaction_type: string | null
                    created_at: string | null
                }
                Insert: {
                    id?: string
                    client_id?: string | null
                    seller_id?: string | null
                    items?: Json | null
                    total_amount?: number | null
                    payment_terms?: Json | null
                    status?: string | null
                    folio?: number | null
                    comments?: string | null
                    interaction_type?: string | null
                    created_at?: string | null
                }
                Update: {
                    id?: string
                    client_id?: string | null
                    seller_id?: string | null
                    items?: Json | null
                    total_amount?: number | null
                    payment_terms?: Json | null
                    status?: string | null
                    folio?: number | null
                    comments?: string | null
                    interaction_type?: string | null
                    created_at?: string | null
                }
            }
        }
    }
}
