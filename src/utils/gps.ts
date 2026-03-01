export interface GPSRequestOptions {
    enableHighAccuracy?: boolean;
    timeoutMs?: number;
    maximumAgeMs?: number;
    retries?: number;
    minAccuracyMeters?: number;
    showAlert?: boolean;
}

export interface GPSWatchOptions {
    enableHighAccuracy?: boolean;
    timeoutMs?: number;
    maximumAgeMs?: number;
    minAccuracyMeters?: number;
}

const isValidCoordinates = (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
    if (lat === 0 && lng === 0) return false;
    return true;
};

const buildErrorMessage = (error: GeolocationPositionError | null): string => {
    if (!error) {
        return "No se pudo obtener una ubicación GPS confiable. Intenta de nuevo en un lugar abierto.";
    }

    switch (error.code) {
        case error.PERMISSION_DENIED:
            return "Acceso GPS denegado. Activa el permiso de ubicación del navegador para continuar.";
        case error.POSITION_UNAVAILABLE:
            return "GPS sin señal disponible. Verifica que la ubicación del dispositivo esté activa.";
        case error.TIMEOUT:
            return "El GPS tardó demasiado en responder. Intenta nuevamente con mejor señal.";
        default:
            return `Error de GPS (${error.code}): ${error.message || "desconocido"}`;
    }
};

const getCurrentPositionOnce = (options: PositionOptions): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
};

export const getCurrentLocation = async (options: GPSRequestOptions = {}): Promise<GeolocationPosition> => {
    const {
        enableHighAccuracy = true,
        timeoutMs = 10000,
        maximumAgeMs = 0,
        retries = 1,
        minAccuracyMeters,
        showAlert = false
    } = options;

    if (!navigator.geolocation) {
        const msg = "Este dispositivo o navegador no soporta geolocalización.";
        if (showAlert) alert(msg);
        throw new Error(msg);
    }

    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        const msg = "GPS requiere HTTPS en producción. Verifica la URL del sistema.";
        if (showAlert) alert(msg);
        throw new Error(msg);
    }

    let lastError: GeolocationPositionError | null = null;
    const attempts = Math.max(1, retries + 1);

    for (let i = 0; i < attempts; i++) {
        try {
            const position = await getCurrentPositionOnce({
                enableHighAccuracy,
                timeout: timeoutMs,
                maximumAge: maximumAgeMs
            });

            const { latitude, longitude, accuracy } = position.coords;
            if (!isValidCoordinates(latitude, longitude)) {
                throw new Error("GPS inválido: coordenadas fuera de rango.");
            }

            if (typeof minAccuracyMeters === 'number' && Number.isFinite(accuracy) && accuracy > minAccuracyMeters) {
                throw new Error(`GPS impreciso (${Math.round(accuracy)}m).`);
            }

            return position;
        } catch (error: any) {
            if (typeof error?.code === 'number') {
                lastError = error as GeolocationPositionError;
            }
            if (i < attempts - 1) {
                await new Promise((resolve) => setTimeout(resolve, 800));
            } else {
                const msg = buildErrorMessage(lastError);
                if (showAlert) alert(msg);
                throw new Error(msg);
            }
        }
    }

    const fallbackMsg = buildErrorMessage(lastError);
    if (showAlert) alert(fallbackMsg);
    throw new Error(fallbackMsg);
};

export const watchCurrentLocation = (
    onPosition: (position: GeolocationPosition) => void,
    onError?: (error: Error) => void,
    options: GPSWatchOptions = {}
): number | null => {
    const {
        enableHighAccuracy = true,
        timeoutMs = 10000,
        maximumAgeMs = 3000,
        minAccuracyMeters
    } = options;

    if (!navigator.geolocation) {
        onError?.(new Error("Geolocalización no soportada."));
        return null;
    }

    return navigator.geolocation.watchPosition(
        (position) => {
            const { latitude, longitude, accuracy } = position.coords;
            if (!isValidCoordinates(latitude, longitude)) return;
            if (typeof minAccuracyMeters === 'number' && Number.isFinite(accuracy) && accuracy > minAccuracyMeters) return;
            onPosition(position);
        },
        (error) => {
            onError?.(new Error(buildErrorMessage(error)));
        },
        {
            enableHighAccuracy,
            timeout: timeoutMs,
            maximumAge: maximumAgeMs
        }
    );
};

export const checkGPSConnection = (options: GPSRequestOptions = {}): Promise<GeolocationPosition> => {
    return getCurrentLocation({
        showAlert: true,
        enableHighAccuracy: true,
        timeoutMs: 10000,
        maximumAgeMs: 0,
        retries: 1,
        minAccuracyMeters: 250,
        ...options
    });
};
