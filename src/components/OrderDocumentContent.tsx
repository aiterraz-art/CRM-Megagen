import React from 'react';
import type { OrderPdfData, OrderPdfItem } from '../utils/orderPdf';

const normalizeCompanyValue = (value?: string | null) => {
    const cleaned = (value || '').trim();
    if (!cleaned) return '';
    const lower = cleaned.toLowerCase();
    if (
        lower === '---'
        || lower === '-'
        || lower === 'n/a'
        || lower === 'na'
        || lower === 'null'
        || lower === 'undefined'
        || lower.includes('por configurar')
    ) {
        return '';
    }
    return cleaned;
};

type OrderDocumentViewModel = {
    companyName: string;
    companyLogo: string;
    companyGiro: string;
    companyAddress: string;
    companyPhone: string;
    companyRut: string;
    sellerEmail: string;
    items: OrderPdfItem[];
    subtotal: number;
    tax: number;
    total: number;
};

const buildOrderDocumentViewModel = (data: OrderPdfData): OrderDocumentViewModel => {
    const companyName = normalizeCompanyValue(import.meta.env.VITE_COMPANY_NAME) || 'MEGAGEN IMPLANT';
    const companyLogo = import.meta.env.VITE_COMPANY_LOGO || '/logo_megagen.png';
    const is3DentalCompany = companyName.toLowerCase().includes('3dental');
    const companyGiro = normalizeCompanyValue(import.meta.env.VITE_COMPANY_GIRO) || 'Venta insumos dentales';
    const companyAddress = normalizeCompanyValue(import.meta.env.VITE_COMPANY_ADDRESS) || (is3DentalCompany ? 'Americo Vespucio 2880 of 1403, Conchali' : 'Avenida Americo Vespucio 2880 of 1403, CONCHALI');
    const companyPhone = normalizeCompanyValue(import.meta.env.VITE_COMPANY_PHONE) || '961183899';
    const companyEmail = normalizeCompanyValue(import.meta.env.VITE_COMPANY_EMAIL) || normalizeCompanyValue(import.meta.env.VITE_OWNER_EMAIL) || 'aterraza@imegagen.cl';
    const companyRut = normalizeCompanyValue(import.meta.env.VITE_COMPANY_RUT) || (is3DentalCompany ? '76.921-029-6' : '76.921.029-6');
    const sellerEmail = normalizeCompanyValue(data.sellerEmail) || companyEmail;

    const items = Array.isArray(data.items) ? data.items : [];
    const subtotal = items.reduce((acc, item) => acc + Number(item.total || 0), 0);
    const tax = Math.round(subtotal * 0.19);
    const total = Number(data.totalAmount || 0) || subtotal + tax;

    return {
        companyName,
        companyLogo,
        companyGiro,
        companyAddress,
        companyPhone,
        companyRut,
        sellerEmail,
        items,
        subtotal,
        tax,
        total
    };
};

const numberToWords = (_num: number) => 'MONTO TOTAL EN PESOS';

const OrderDocumentContent: React.FC<{ data: OrderPdfData }> = ({ data }) => {
    const {
        companyName,
        companyLogo,
        companyGiro,
        companyAddress,
        companyPhone,
        companyRut,
        sellerEmail,
        items,
        subtotal,
        tax,
        total
    } = buildOrderDocumentViewModel(data);

    return (
        <>
            <div className="flex justify-between items-start mb-10">
                <div className="space-y-1">
                    <div className="flex items-center space-x-2 mb-4">
                        <img src={companyLogo} alt={companyName} className="h-16 w-auto" />
                    </div>
                    <p className="font-bold text-xs uppercase">{companyName}</p>
                    <p>{companyGiro}</p>
                    <p>{companyAddress}</p>
                    <p>Telefono: {companyPhone}</p>
                    <p>Email: <span className="text-blue-600 underline">{sellerEmail}</span></p>
                </div>

                <div className="w-64 border-2 border-orange-400 p-4 text-center rounded-lg space-y-2">
                    <p className="text-orange-500 font-extrabold text-sm tracking-widest">R.U.T: {companyRut}</p>
                    <p className="text-orange-500 font-black text-lg uppercase tracking-wider">Pedido</p>
                    <p className="text-orange-500 font-extrabold text-sm uppercase">Folio N° {data.folio}</p>
                </div>
            </div>

            <div className="grid grid-cols-12 gap-y-3 mb-8 border-t border-b border-gray-100 py-6 text-[11px]">
                <div className="col-span-4 self-start">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Señor (es)</p>
                    <p className="font-bold uppercase text-[12px]">{data.clientName}</p>
                </div>
                <div className="col-span-3">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Ciudad</p>
                    <p className="font-bold uppercase">{data.clientCity || 'SANTIAGO'}</p>
                </div>
                <div className="col-span-3">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Giro</p>
                    <p className="font-bold uppercase truncate pr-4" title={data.clientGiro}>{data.clientGiro || 'SIN GIRO'}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">R.U.T</p>
                    <p className="font-bold uppercase">{data.clientRut || 'SIN RUT'}</p>
                </div>

                <div className="col-span-4">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Dirección</p>
                    <p className="font-bold uppercase">
                        {data.clientAddress || data.clientComuna || 'SIN DIRECCIÓN'}
                    </p>
                </div>
                <div className="col-span-3">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Condición de pago</p>
                    <p className="font-bold uppercase">{data.paymentTerms || 'CONTADO'}</p>
                </div>
                <div className="col-span-3">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Vendedor</p>
                    <p className="font-bold uppercase">{data.sellerName}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Tipo de Cambio</p>
                    <p className="font-bold uppercase">PESO</p>
                </div>

                <div className="col-span-4">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Comuna</p>
                    <p className="font-bold uppercase">{data.clientComuna || ''}</p>
                </div>
                <div className="col-span-3">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Fecha Emisión</p>
                    <p className="font-bold uppercase">{data.date}</p>
                </div>
                <div className="col-span-3">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Referencia</p>
                    <p className="font-bold uppercase">{data.quotationFolio ? `COTIZACIÓN #${data.quotationFolio}` : 'PEDIDO DIRECTO'}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Tasa de Cambio</p>
                    <p className="font-bold uppercase">1</p>
                </div>

                {(data.clientContact || data.clientPhone || data.clientEmail) && (
                    <div className="col-span-12 grid grid-cols-12 mt-2 pt-3 border-t border-gray-50 bg-gray-50/20 rounded-lg">
                        <div className="col-span-4 pl-2">
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Atención Dr/Clínica</p>
                            <p className="font-bold uppercase text-[10px] text-indigo-600">{data.clientContact || '---'}</p>
                        </div>
                        <div className="col-span-4">
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Teléfono Contacto</p>
                            <p className="font-bold uppercase text-[10px]">{data.clientPhone || '---'}</p>
                        </div>
                        <div className="col-span-4">
                            <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Email Contacto</p>
                            <p className="font-bold uppercase text-[10px] lowercase text-blue-500">{data.clientEmail || '---'}</p>
                        </div>
                    </div>
                )}
            </div>

            <div className="min-h-[140px] text-[11px]">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b-2 border-gray-100 text-sm font-bold text-gray-500">
                            <th className="py-4 text-left pl-4">Ítem</th>
                            <th className="p-2 font-medium w-24">Código</th>
                            <th className="p-2 font-medium">Detalle</th>
                            <th className="p-2 font-medium w-16 text-center">Cant</th>
                            <th className="p-2 font-medium w-24 text-right">P. Unitario</th>
                            <th className="p-2 font-medium w-20 text-right">Rec/Desc</th>
                            <th className="p-2 font-medium w-24 text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item, index) => (
                            <React.Fragment key={index}>
                                <tr className="border-b border-gray-50 align-top">
                                    <td className="p-2 text-center text-gray-400">{index + 1}</td>
                                    <td className="p-2 font-medium">{item.code || '-'}</td>
                                    <td className="p-2 font-black uppercase tracking-tight">{item.detail}</td>
                                    <td className="p-2 text-center uppercase">{item.qty} {item.unit || 'UN'}</td>
                                    <td className="p-2 text-right">${Number(item.unitPrice || 0).toLocaleString()}</td>
                                    <td className="p-2 text-right border-l border-gray-50 text-gray-400">$0</td>
                                    <td className="p-2 text-right font-bold border-l border-gray-50">${Number(item.total || 0).toLocaleString()}</td>
                                </tr>
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="grid grid-cols-12 mt-8 gap-8 items-start text-[11px]">
                <div className="col-span-8 border border-gray-100 rounded-lg p-6 min-h-[100px]">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-4">Comentario</p>
                    <p className="text-gray-600 font-medium italic">{data.comments || (data.quotationFolio ? `Pedido generado desde cotización #${data.quotationFolio}.` : 'Pedido generado desde CRM.')}</p>
                </div>

                <div className="col-span-4 space-y-2">
                    <div className="flex justify-between items-center text-gray-500">
                        <span className="font-bold">Recargo/Dscto.</span>
                        <span>$ 0</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-800 font-bold">
                        <span>Afecto</span>
                        <span>$ {subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-500">
                        <span>Exento</span>
                        <span>$ 0</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-800 font-bold">
                        <span>19% IVA</span>
                        <span>$ {tax.toLocaleString()}</span>
                    </div>

                    <div className="pt-6 border-t border-gray-100 flex justify-between items-end">
                        <div>
                            <p className="font-bold text-lg text-orange-400 tracking-tighter">Total</p>
                            <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest leading-none mt-1">{numberToWords(total)}</p>
                        </div>
                        <p className="text-2xl font-black text-orange-400 tracking-tighter leading-none">$ {total.toLocaleString()}</p>
                    </div>
                </div>
            </div>

            <div className="mt-auto pt-12 flex justify-center opacity-10 grayscale">
                <div className="text-xl font-black text-gray-400 tracking-tighter italic">
                    {import.meta.env.VITE_COMPANY_NAME?.split(' ')[0] || 'Megagen'}
                    <span className="text-gray-400 font-light not-italic text-xs ml-1 uppercase">
                        {import.meta.env.VITE_COMPANY_NAME?.split(' ').slice(1).join(' ') || 'Chile'}
                    </span>
                </div>
            </div>
        </>
    );
};

export default OrderDocumentContent;
