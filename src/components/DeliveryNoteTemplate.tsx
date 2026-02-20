import React, { useRef, useState } from 'react';
import { Printer, X } from 'lucide-react';

interface DeliveryItem {
    code: string;
    detail: string;
    qty: number;
    unit: string;
}

interface DeliveryData {
    folio: number; // Order Folio
    date: string;
    clientName: string;
    clientRut: string;
    clientAddress: string;
    clientOffice?: string;
    clientPhone?: string;
    items: DeliveryItem[];
    driverName?: string;
}

interface Props {
    data: DeliveryData;
    onClose: () => void;
}

const DeliveryNoteTemplate: React.FC<Props> = ({ data, onClose }) => {
    const contentRef = useRef<HTMLDivElement>(null);

    const handlePrint = () => {
        window.print();
    };

    return (
        <div
            className="fixed inset-0 z-[9999] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-8 overflow-y-auto cursor-pointer"
            onClick={onClose}
        >
            <div
                className="bg-white w-full max-w-4xl shadow-2xl rounded-lg flex flex-col max-h-[95vh] overflow-y-auto animate-in fade-in zoom-in duration-300 cursor-default"
                onClick={(e) => e.stopPropagation()}
            >

                {/* Actions Header (Not part of print) */}
                <div className="bg-gray-100 p-4 border-b flex justify-between items-center print:hidden">
                    <h3 className="font-bold text-gray-700">Guía de Despacho</h3>

                    <div className="flex items-center space-x-4">
                        <button onClick={handlePrint} className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-all shadow-md">
                            <Printer size={16} className="mr-2" /> Imprimir
                        </button>
                        <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-all text-gray-400">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Print Content */}
                <div ref={contentRef} className="flex-1 p-12 bg-white text-gray-800 print:p-0 font-sans">

                    {/* Header */}
                    <div className="flex justify-between items-start mb-10 border-b-2 border-slate-900 pb-8">
                        <div className="flex items-center gap-4">
                            <img src="/logo_megagen.png" alt="Megagen" className="h-16 w-auto grayscale" />
                            <div>
                                <p className="font-black text-xl uppercase tracking-tighter">Megagen<span className="font-light">Chile</span></p>
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Guía de Despacho</p>
                            </div>
                        </div>

                        <div className="text-right">
                            <p className="text-4xl font-black text-slate-900">#{data.folio}</p>
                            <p className="font-medium text-gray-500">{data.date}</p>
                        </div>
                    </div>

                    {/* Info Grid */}
                    <div className="grid grid-cols-2 gap-12 mb-12">
                        <div>
                            <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">Destinatario</p>
                            <h2 className="text-xl font-bold text-slate-900 leading-tight mb-1">{data.clientName}</h2>
                            <p className="text-sm text-gray-600 font-medium mb-1">{data.clientRut}</p>
                            <p className="text-sm text-gray-500 mb-1">
                                {data.clientAddress}
                                {data.clientOffice && <span className="ml-1 text-indigo-600 font-bold">({data.clientOffice})</span>}
                            </p>
                            {data.clientPhone && <p className="text-sm text-gray-500">Tel: {data.clientPhone}</p>}
                        </div>
                        <div>
                            <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">Transportista</p>
                            <p className="text-lg font-bold text-slate-900">{data.driverName || 'Por Asignar'}</p>
                            <p className="text-sm text-gray-500 mt-4 italic">
                                "Certifico que la carga corresponde a lo detallado en este documento."
                            </p>
                        </div>
                    </div>

                    {/* Items Table */}
                    <table className="w-full text-left border-collapse mb-16">
                        <thead>
                            <tr className="border-b-2 border-gray-100">
                                <th className="py-3 text-[10px] uppercase font-black text-gray-400 tracking-widest w-24">Código</th>
                                <th className="py-3 text-[10px] uppercase font-black text-gray-400 tracking-widest">Descripción</th>
                                <th className="py-3 text-[10px] uppercase font-black text-gray-400 tracking-widest text-right w-24">Cant.</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.items.map((item, idx) => (
                                <tr key={idx} className="border-b border-gray-50">
                                    <td className="py-4 font-mono text-sm text-gray-500">{item.code}</td>
                                    <td className="py-4 font-bold text-slate-900">{item.detail}</td>
                                    <td className="py-4 text-right font-bold text-slate-900">{item.qty} {item.unit}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Footer / Signature */}
                    <div className="mt-auto border-t-2 border-dashed border-gray-200 pt-8 page-break-inside-avoid">
                        <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-16 text-center">Recibo Conforme</p>

                        <div className="grid grid-cols-3 gap-8">
                            <div className="border-t border-gray-300 pt-2">
                                <p className="text-xs font-bold text-gray-400 uppercase">Nombre</p>
                            </div>
                            <div className="border-t border-gray-300 pt-2">
                                <p className="text-xs font-bold text-gray-400 uppercase">RUT / Firma</p>
                            </div>
                            <div className="border-t border-gray-300 pt-2">
                                <p className="text-xs font-bold text-gray-400 uppercase">Fecha / Hora</p>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

export default DeliveryNoteTemplate;
