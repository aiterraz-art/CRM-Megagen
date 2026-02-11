export const checkGPSConnection = (): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            const msg = "❌ Tu dispositivo no soporta geolocalización o está bloqueada por el navegador.";
            alert(msg);
            reject(new Error(msg));
            return;
        }

        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0 // Force fresh reading
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                // strict check for valid coordinates
                if (position.coords.latitude === 0 && position.coords.longitude === 0) {
                    const msg = "⚠️ GPS Inválido: Coordenadas (0,0). Reinicia el GPS.";
                    alert(msg);
                    reject(new Error(msg));
                    return;
                }
                resolve(position);
            },
            (error) => {
                let msg = "Error desconocido de GPS.";
                let detailedHelp = "";

                switch (error.code) {
                    case error.PERMISSION_DENIED:
                        msg = "🚫 ACCESO DENEGADO";
                        detailedHelp = "Has bloqueado el permiso de ubicación. Ve a la configuración del navegador (sitio web) y permite el acceso a la ubicación.";
                        break;
                    case error.POSITION_UNAVAILABLE:
                        msg = "📡 GPS APAGADO O SIN SEÑAL";
                        detailedHelp = "Tu dispositivo no puede encontrar tu ubicación. \n1. Enciende el GPS (Ubicación).\n2. Asegúrate de tener señal o WiFi.\n3. Si estás en modo ahorro de batería, desactívalo.";
                        break;
                    case error.TIMEOUT:
                        msg = "🐢 TIEMPO DE ESPERA AGOTADO";
                        detailedHelp = "El GPS tardó demasiado. Intenta nuevamente en un lugar más despejado.";
                        break;
                    default:
                        msg = `Error GPS (${error.code})`;
                        detailedHelp = error.message;
                }

                alert(`${msg}\n\n${detailedHelp}\n\nEsta acción NO puede proceder sin verificación de ubicación.`);
                reject(new Error(msg));
            },
            options
        );
    });
};
