
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { order_id } = await req.json()

        if (!order_id) {
            throw new Error('Missing order_id')
        }

        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

        // 1. Fetch Order Details
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select(`
        *,
        client:clients(*),
        items:order_items(*)
      `)
            .eq('id', order_id)
            .single()

        if (orderError || !order) {
            throw new Error('Order not found')
        }

        // 2. Format Items Table
        const itemsHtml = order.items.map((item: any) => `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.product_name || 'Producto'}</td>
        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item.quantity}</td>
      </tr>
    `).join('')

        // 3. Compose Email
        const emailHtml = `
      <h1>¡Tu pedido ha sido entregado!</h1>
      <p>Hola ${order.client.name},</p>
      <p>Te confirmamos que tu pedido <strong>#${order.folio || order.id.slice(0, 8)}</strong> ha sido entregado exitosamente.</p>
      
      <h3>Detalle de la entrega:</h3>
      <ul>
        <li><strong>Fecha:</strong> ${new Date().toLocaleDateString('es-CL')}</li>
        <li><strong>Dirección:</strong> ${order.client.address}</li>
      </ul>

      <h3>Productos Entregados:</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="text-align: left;">
            <th style="padding: 8px; border-bottom: 2px solid #ddd;">Producto</th>
            <th style="padding: 8px; border-bottom: 2px solid #ddd;">Cantidad</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      ${order.delivery_photo_url ? `
        <h3>Evidencia de Entrega:</h3>
        <img src="${order.delivery_photo_url}" alt="Foto de Entrega" style="max-width: 100%; border-radius: 8px; margin-top: 10px;" />
      ` : ''}

      <p style="margin-top: 20px; font-size: 12px; color: #888;">Si tienes alguna duda, contáctanos.</p>
    `

        // 4. Send Email via Resend
        if (!RESEND_API_KEY) {
            console.log('RESEND_API_KEY Missing - Logging Email Content instead:')
            console.log(emailHtml)
            return new Response(
                JSON.stringify({ message: 'Email simulated (No API Key)', success: true }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify({
                from: 'Delivery System <onboarding@resend.dev>', // Update with verified domain if available
                to: order.client.email || 'delivered@example.com', // Fallback for dev
                subject: `Entrega Confirmada - Pedido #${order.folio || order.id.slice(0, 8)}`,
                html: emailHtml,
            }),
        })

        const data = await res.json()

        // 5. Log activity
        await supabase.from('email_logs').insert({
            client_id: order.client.id,
            subject: `Entrega Confirmada - Order #${order.id.slice(0, 8)}`,
            snippet: 'Notificación automática de entrega completada.',
            user_id: order.user_id // Original seller or system user
        })

        return new Response(
            JSON.stringify(data),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error: any) {
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
