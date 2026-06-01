import React from 'react';
import type { PurchaseOrderPdfData } from '../utils/purchaseOrderPdf';

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

const formatMoney = (value: number, currency: 'CLP' | 'USD') =>
    new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency,
        minimumFractionDigits: currency === 'CLP' ? 0 : 2,
        maximumFractionDigits: currency === 'CLP' ? 0 : 2,
    }).format(Number(value || 0));

const PurchaseOrderDocumentContent: React.FC<{ data: PurchaseOrderPdfData }> = ({ data }) => {
    const companyName = normalizeCompanyValue(import.meta.env.VITE_COMPANY_NAME) || 'MEGAGEN IMPLANT';
    const companyLogo = import.meta.env.VITE_COMPANY_LOGO || '/logo_megagen.png';
    const companyGiro = normalizeCompanyValue(import.meta.env.VITE_COMPANY_GIRO) || 'Gestión logística y abastecimiento';
    const companyAddress = normalizeCompanyValue(import.meta.env.VITE_COMPANY_ADDRESS) || 'Avenida Americo Vespucio 2880 of 1403, Conchali';
    const companyPhone = normalizeCompanyValue(import.meta.env.VITE_COMPANY_PHONE) || '961183899';
    const companyRut = normalizeCompanyValue(import.meta.env.VITE_COMPANY_RUT) || '76.921.029-6';
    const companyEmail = normalizeCompanyValue(import.meta.env.VITE_COMPANY_EMAIL) || normalizeCompanyValue(import.meta.env.VITE_OWNER_EMAIL) || 'aterraza@imegagen.cl';

    return (
        <>
            <div className="flex items-start justify-between mb-10">
                <div className="space-y-1">
                    <div className="flex items-center space-x-2 mb-4">
                        <img src={companyLogo} alt={companyName} className="h-16 w-auto" />
                    </div>
                    <p className="font-bold text-xs uppercase">{companyName}</p>
                    <p>{companyGiro}</p>
                    <p>{companyAddress}</p>
                    <p>Telefono: {companyPhone}</p>
                    <p>Email: <span className="text-blue-600 underline">{companyEmail}</span></p>
                </div>

                <div className="w-72 border-2 border-slate-900 p-4 text-center rounded-lg space-y-2">
                    <p className="text-slate-700 font-extrabold text-sm tracking-widest">R.U.T: {companyRut}</p>
                    <p className="text-slate-900 font-black text-lg uppercase tracking-wider">Orden de Compra</p>
                    <p className="text-slate-700 font-extrabold text-sm uppercase">OC N° {data.formattedFolio}</p>
                </div>
            </div>

            <div className="grid grid-cols-12 gap-y-3 mb-8 border-t border-b border-gray-100 py-6 text-[11px]">
                <div className="col-span-5">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Proveedor</p>
                    <p className="font-bold uppercase text-[12px]">{data.supplierName}</p>
                </div>
                <div className="col-span-3">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">R.U.T / Tax ID</p>
                    <p className="font-bold uppercase">{data.supplierTaxId || 'SIN REGISTRO'}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Moneda</p>
                    <p className="font-bold uppercase">{data.currency}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Fecha Emisión</p>
                    <p className="font-bold uppercase">{data.issuedDate}</p>
                </div>

                <div className="col-span-5">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Correo Proveedor</p>
                    <p className="font-bold lowercase text-blue-600">{data.supplierEmail}</p>
                </div>
                <div className="col-span-3">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Contacto</p>
                    <p className="font-bold uppercase">{data.supplierContact || 'SIN CONTACTO'}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Fecha Requerida</p>
                    <p className="font-bold uppercase">{data.neededByDate || 'SIN FECHA'}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Emisor</p>
                    <p className="font-bold uppercase">{data.createdByName}</p>
                </div>

                <div className="col-span-8">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Dirección Comercial</p>
                    <p className="font-bold uppercase">{data.supplierAddress || 'SIN DIRECCIÓN'}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">Ciudad</p>
                    <p className="font-bold uppercase">{data.supplierCity || 'SIN CIUDAD'}</p>
                </div>
                <div className="col-span-2">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-1">País</p>
                    <p className="font-bold uppercase">{data.supplierCountry || 'SIN PAÍS'}</p>
                </div>
            </div>

            <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                    <tr className="border-b-2 border-gray-100 text-sm font-bold text-gray-500">
                        <th className="py-4 pl-4">Ítem</th>
                        <th className="p-2 w-28">SKU</th>
                        <th className="p-2">Producto</th>
                        <th className="p-2 w-16 text-center">Cant.</th>
                        <th className="p-2 w-28 text-right">P. Unitario</th>
                        <th className="p-2 w-28 text-right">Descuento</th>
                        <th className="p-2 w-28 text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
                    {data.items.map((item, index) => (
                        <React.Fragment key={`${item.sku}-${index}`}>
                            <tr className="border-b border-gray-50 align-top">
                                <td className="p-2 text-center text-gray-400">{index + 1}</td>
                                <td className="p-2 font-medium">{item.sku}</td>
                                <td className="p-2">
                                    <p className="font-black uppercase tracking-tight">{item.productName}</p>
                                    {item.lineNotes && <p className="mt-1 text-[10px] text-gray-500">{item.lineNotes}</p>}
                                </td>
                                <td className="p-2 text-center font-bold">{item.qty}</td>
                                <td className="p-2 text-right">{formatMoney(item.unitPrice, data.currency)}</td>
                                <td className="p-2 text-right">{formatMoney(item.discountAmount, data.currency)}</td>
                                <td className="p-2 text-right font-bold">{formatMoney(item.lineTotal, data.currency)}</td>
                            </tr>
                        </React.Fragment>
                    ))}
                </tbody>
            </table>

            <div className="grid grid-cols-12 mt-8 gap-8 items-start text-[11px]">
                <div className="col-span-8 border border-gray-100 rounded-lg p-6 min-h-[110px]">
                    <p className="text-[9px] text-gray-400 font-bold uppercase tracking-widest leading-none mb-4">Observaciones</p>
                    <p className="text-gray-600 font-medium italic whitespace-pre-wrap">{data.generalNotes || 'Sin observaciones generales.'}</p>
                </div>

                <div className="col-span-4 space-y-3">
                    <div className="flex justify-between items-center text-gray-700 font-bold">
                        <span>Subtotal</span>
                        <span>{formatMoney(data.subtotal, data.currency)}</span>
                    </div>
                    <div className="flex justify-between items-center text-gray-700 font-bold">
                        <span>Descuento</span>
                        <span>{formatMoney(data.totalDiscount, data.currency)}</span>
                    </div>
                    <div className="pt-6 border-t border-gray-100 flex justify-between items-end">
                        <div>
                            <p className="font-bold text-lg text-slate-900 tracking-tight">Total</p>
                            <p className="text-[8px] text-gray-400 font-black uppercase tracking-widest leading-none mt-1">{data.currency}</p>
                        </div>
                        <p className="text-2xl font-black text-slate-900 tracking-tight leading-none">{formatMoney(data.totalAmount, data.currency)}</p>
                    </div>
                </div>
            </div>
        </>
    );
};

export default PurchaseOrderDocumentContent;
