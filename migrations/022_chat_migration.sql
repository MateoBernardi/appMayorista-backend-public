CREATE TABLE IF NOT EXISTS solicitudes_bitacora_archivo (
    bitacora_id BIGINT NOT NULL,
    archivo_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- Llave primaria compuesta para evitar duplicados exactos
    PRIMARY KEY (bitacora_id, archivo_id),
    
    -- Llaves foráneas (Asumiendo que tienes una tabla maestra 'archivos')
    CONSTRAINT fk_bitacora_archivo_bitacora 
        FOREIGN KEY (bitacora_id) 
        REFERENCES solicitudes_bitacora(id) 
        ON DELETE CASCADE,
        
    CONSTRAINT fk_bitacora_archivo_archivo 
        FOREIGN KEY (archivo_id) 
        REFERENCES archivos(id) -- Cambia 'archivos(id)' por tu tabla real de archivos
        ON DELETE CASCADE
);