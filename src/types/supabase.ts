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
                    pending_seller_email: string | null
                    created_at: string
                    updated_at: string
                    rut: string | null
                    credit_days: number
                    phone: string | null
                    email: string | null
                    notes: string | null
                    giro: string | null
                    doctor_specialty: string | null
                    comuna: string | null
                    office: string | null
                    lead_score: number | null
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
                    pending_seller_email?: string | null
                    created_at?: string
                    updated_at?: string
                    rut?: string | null
                    credit_days?: number
                    phone?: string | null
                    email?: string | null
                    notes?: string | null
                    giro?: string | null
                    doctor_specialty?: string | null
                    comuna?: string | null
                    office?: string | null
                    lead_score?: number | null
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
                    pending_seller_email?: string | null
                    created_at?: string
                    updated_at?: string
                    rut?: string | null
                    credit_days?: number
                    phone?: string | null
                    email?: string | null
                    notes?: string | null
                    giro?: string | null
                    doctor_specialty?: string | null
                    comuna?: string | null
                    office?: string | null
                    lead_score?: number | null
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
                    doctor_name: string | null
                    google_event_id: string | null
                    id: string
                    lat: number | null
                    lng: number | null
                    notes: string | null
                    outcome: string | null
                    purpose: string | null
                    sales_rep_id: string | null
                    type: string | null
                    status: string | null
                    title: string | null
                }
                Insert: {
                    check_in_time?: string | null
                    check_out_time?: string | null
                    check_out_lat?: number | null
                    check_out_lng?: number | null
                    client_id?: string | null
                    doctor_name?: string | null
                    google_event_id?: string | null
                    id?: string
                    lat?: number | null
                    lng?: number | null
                    notes?: string | null
                    outcome?: string | null
                    purpose?: string | null
                    sales_rep_id?: string | null
                    type?: string | null
                    status?: string | null
                    title?: string | null
                }
                Update: {
                    check_in_time?: string | null
                    check_out_time?: string | null
                    check_out_lat?: number | null
                    check_out_lng?: number | null
                    client_id?: string | null
                    doctor_name?: string | null
                    google_event_id?: string | null
                    id?: string
                    lat?: number | null
                    lng?: number | null
                    notes?: string | null
                    outcome?: string | null
                    purpose?: string | null
                    sales_rep_id?: string | null
                    type?: string | null
                    status?: string | null
                    title?: string | null
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
                    client_id: string | null
                    created_at: string | null
                    delivery_photo_url: string | null
                    delivery_status: string | null
                    delivered_at: string | null
                    id: string
                    folio: number | null
                    interaction_type: string | null
                    items: Json | null
                    notes: string | null
                    payment_email_error: string | null
                    payment_email_sent_at: string | null
                    payment_email_status: string
                    payment_proof_mime_type: string | null
                    payment_proof_name: string | null
                    payment_proof_path: string | null
                    payment_proof_uploaded_at: string | null
                    quotation_id: string | null
                    route_id: string | null
                    status: string | null
                    total_amount: number | null
                    total_discount: number | null
                    user_id: string | null
                    visit_id: string | null
                }
                Insert: {
                    client_id?: string | null
                    created_at?: string | null
                    delivery_photo_url?: string | null
                    delivery_status?: string | null
                    delivered_at?: string | null
                    id?: string
                    folio?: number | null
                    interaction_type?: string | null
                    items?: Json | null
                    notes?: string | null
                    payment_email_error?: string | null
                    payment_email_sent_at?: string | null
                    payment_email_status?: string
                    payment_proof_mime_type?: string | null
                    payment_proof_name?: string | null
                    payment_proof_path?: string | null
                    payment_proof_uploaded_at?: string | null
                    quotation_id?: string | null
                    route_id?: string | null
                    status?: string | null
                    total_amount?: number | null
                    total_discount?: number | null
                    user_id?: string | null
                    visit_id?: string | null
                }
                Update: {
                    client_id?: string | null
                    created_at?: string | null
                    delivery_photo_url?: string | null
                    delivery_status?: string | null
                    delivered_at?: string | null
                    id?: string
                    folio?: number | null
                    interaction_type?: string | null
                    items?: Json | null
                    notes?: string | null
                    payment_email_error?: string | null
                    payment_email_sent_at?: string | null
                    payment_email_status?: string
                    payment_proof_mime_type?: string | null
                    payment_proof_name?: string | null
                    payment_proof_path?: string | null
                    payment_proof_uploaded_at?: string | null
                    quotation_id?: string | null
                    route_id?: string | null
                    status?: string | null
                    total_amount?: number | null
                    total_discount?: number | null
                    user_id?: string | null
                    visit_id?: string | null
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
                    end_date: string | null
                    google_calendar_id: string | null
                    google_event_id: string | null
                    google_html_link: string | null
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
                    end_date?: string | null
                    google_calendar_id?: string | null
                    google_event_id?: string | null
                    google_html_link?: string | null
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
                    end_date?: string | null
                    google_calendar_id?: string | null
                    google_event_id?: string | null
                    google_html_link?: string | null
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
                    sent_at: string | null
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
                    sent_at?: string | null
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
                    sent_at?: string | null
                    folio?: number | null
                    comments?: string | null
                    interaction_type?: string | null
                    created_at?: string | null
                }
            }
            lead_message_templates: {
                Row: {
                    id: string
                    name: string
                    channel: 'email' | 'whatsapp' | 'both'
                    subject: string | null
                    body: string
                    is_active: boolean
                    created_by: string | null
                    created_at: string
                    updated_at: string
                }
                Insert: {
                    id?: string
                    name: string
                    channel: 'email' | 'whatsapp' | 'both'
                    subject?: string | null
                    body: string
                    is_active?: boolean
                    created_by?: string | null
                    created_at?: string
                    updated_at?: string
                }
                Update: {
                    id?: string
                    name?: string
                    channel?: 'email' | 'whatsapp' | 'both'
                    subject?: string | null
                    body?: string
                    is_active?: boolean
                    created_by?: string | null
                    created_at?: string
                    updated_at?: string
                }
            }
            lead_message_attachments: {
                Row: {
                    id: string
                    template_id: string
                    file_name: string
                    file_path: string
                    mime_type: string | null
                    size_bytes: number | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    template_id: string
                    file_name: string
                    file_path: string
                    mime_type?: string | null
                    size_bytes?: number | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    template_id?: string
                    file_name?: string
                    file_path?: string
                    mime_type?: string | null
                    size_bytes?: number | null
                    created_at?: string
                }
            }
            lead_message_logs: {
                Row: {
                    id: string
                    template_id: string | null
                    client_id: string | null
                    user_id: string | null
                    channel: 'email' | 'whatsapp'
                    destination: string | null
                    status: 'sent' | 'failed' | 'opened_external'
                    error_message: string | null
                    created_at: string
                }
                Insert: {
                    id?: string
                    template_id?: string | null
                    client_id?: string | null
                    user_id?: string | null
                    channel: 'email' | 'whatsapp'
                    destination?: string | null
                    status: 'sent' | 'failed' | 'opened_external'
                    error_message?: string | null
                    created_at?: string
                }
                Update: {
                    id?: string
                    template_id?: string | null
                    client_id?: string | null
                    user_id?: string | null
                    channel?: 'email' | 'whatsapp'
                    destination?: string | null
                    status?: 'sent' | 'failed' | 'opened_external'
                    error_message?: string | null
                    created_at?: string
                }
            }
        }
    }
}
