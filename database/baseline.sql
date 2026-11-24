--
-- PostgreSQL database dump
--

\restrict 5ESWGfPmeoWPnCt6A3vKsAtAKPwvBdXeQ3PW1ZMgeYMr2qMcXg2Zg0PB9t02M5Q

-- Dumped from database version 18.4 (Ubuntu 18.4-1.pgdg24.04+1)
-- Dumped by pg_dump version 18.4 (Ubuntu 18.4-1.pgdg24.04+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: mateo
--

-- *not* creating schema, since initdb creates it



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: mateo
--

COMMENT ON SCHEMA public IS '';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: archivo_uso_enum; Type: TYPE; Schema: public; Owner: mateo
--

CREATE TYPE public.archivo_uso_enum AS ENUM (
    'EMPRESA',
    'LICENCIA',
    'MAYORISTA',
    'WEB',
    'TAREA'
);



--
-- Name: categoria_reportes; Type: TYPE; Schema: public; Owner: mateo
--

CREATE TYPE public.categoria_reportes AS ENUM (
    'NEGATIVO',
    'POSITIVO'
);



--
-- Name: estado_invitacion; Type: TYPE; Schema: public; Owner: mateo
--

CREATE TYPE public.estado_invitacion AS ENUM (
    'SENT',
    'SEEN',
    'MODIFIED',
    'ACCEPTED',
    'REJECTED',
    'ACCEPTED_BY_HOST',
    'MODIFIED_BY_HOST',
    'ACTIVIDAD_CREADA',
    'EXPIRED'
);



--
-- Name: estado_reporte; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.estado_reporte AS ENUM (
    'PENDIENTE',
    'DISPUTA',
    'ASENTADO',
    'DESESTIMADO'
);



--
-- Name: estado_solicitud; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.estado_solicitud AS ENUM (
    'PENDIENTE',
    'PENDIENTE_DOCUMENTACION',
    'PENDIENTE_APROBACION',
    'APROBADA',
    'RECHAZADA',
    'CANCELADA',
    'CONSUMIDA',
    'EXPIRADA'
);



--
-- Name: estado_visita_enum; Type: TYPE; Schema: public; Owner: mateo
--

CREATE TYPE public.estado_visita_enum AS ENUM (
    'VENTA',
    'NO_VENTA',
    'CERRADO'
);



--
-- Name: objetivo_bitacora_assign; Type: TYPE; Schema: public; Owner: mateo
--

CREATE TYPE public.objetivo_bitacora_assign AS ENUM (
    'ASSIGN',
    'DISCHARGE'
);



--
-- Name: objetivo_usuario_rol; Type: TYPE; Schema: public; Owner: mateo
--

CREATE TYPE public.objetivo_usuario_rol AS ENUM (
    'ASSIGNEE',
    'VISUALIZER'
);



--
-- Name: rol_participante; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.rol_participante AS ENUM (
    'host',
    'guest'
);



--
-- Name: tipo_actividad; Type: TYPE; Schema: public; Owner: mateo
--

CREATE TYPE public.tipo_actividad AS ENUM (
    'MANDATO',
    'REUNION',
    'CHAT'
);



--
-- Name: tipo_categoria; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.tipo_categoria AS ENUM (
    'interna',
    'externa',
    'feedback_empleado'
);



--
-- Name: token_purpose; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.token_purpose AS ENUM (
    'VALIDATE_IDENTITY',
    'PASSWORD_RESET',
    'EMAIL_CHANGE',
    'ACCOUNT_ASSOCIATION',
    'SENSITIVE_ACTION'
);



--
-- Name: turno_enum; Type: TYPE; Schema: public; Owner: mateo
--

CREATE TYPE public.turno_enum AS ENUM (
    'Mañana',
    'Tarde',
    'Noche',
    'Rotativo'
);



--
-- Name: fn_log_operacion(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_log_operacion() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    pk_col TEXT;
    pk_val INTEGER;
BEGIN
    SELECT a.attname INTO pk_col
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = TG_RELID
      AND i.indisprimary
    LIMIT 1;

    IF pk_col IS NULL THEN
        RAISE EXCEPTION 'No se encontró PK para tabla %', TG_TABLE_NAME;
    END IF;

    EXECUTE FORMAT('SELECT ($1).%I', pk_col) INTO pk_val USING COALESCE(NEW, OLD);

    INSERT INTO logs(tabla, id_registro, operacion, created_at)
    VALUES (
        TG_TABLE_NAME,
        pk_val,
        lower(TG_OP),
        CURRENT_TIMESTAMP
    );

    RETURN COALESCE(NEW, OLD);
END;
$_$;



--
-- Name: fn_set_deleted_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_set_deleted_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    pk_col TEXT;
    pk_val INTEGER;
    sql TEXT;
BEGIN
    -- Buscar el nombre de la PK de la tabla que disparó el trigger
    SELECT a.attname INTO pk_col
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = TG_RELID
      AND i.indisprimary
    LIMIT 1;

    IF pk_col IS NULL THEN
        RAISE EXCEPTION 'No se encontró PK para tabla %', TG_TABLE_NAME;
    END IF;

    -- Obtener el valor de la PK de OLD usando EXECUTE dinámico
    EXECUTE FORMAT('SELECT ($1).%I', pk_col) INTO pk_val USING OLD;

    -- Armar y ejecutar el UPDATE para soft delete
    sql := FORMAT('UPDATE %I SET deleted_at = CURRENT_TIMESTAMP WHERE %I = $1', TG_TABLE_NAME, pk_col);
    EXECUTE sql USING pk_val;

    -- Cancelar DELETE físico
    RETURN NULL;
END;
$_$;



--
-- Name: fn_set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.fn_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;



SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: actividades; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.actividades (
    id integer NOT NULL,
    titulo text NOT NULL,
    descripcion text,
    fecha_inicio timestamp without time zone NOT NULL,
    fecha_fin timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone,
    solicitud_id integer,
    updated_at timestamp without time zone DEFAULT now(),
    notificacion_enviada boolean DEFAULT false
);



--
-- Name: actividades_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.actividades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: actividades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.actividades_id_seq OWNED BY public.actividades.id;


--
-- Name: actividades_participantes; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.actividades_participantes (
    id_actividad integer NOT NULL,
    id_usuario_participante integer NOT NULL,
    prioridad integer DEFAULT 3,
    rol public.rol_participante DEFAULT 'guest'::public.rol_participante
);



--
-- Name: archivo_aperturas; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.archivo_aperturas (
    archivo_id integer NOT NULL,
    usuario_id integer NOT NULL,
    creado_en timestamp without time zone DEFAULT now() NOT NULL
);



--
-- Name: archivos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.archivos (
    id integer NOT NULL,
    nombre text NOT NULL,
    ruta_r2 text NOT NULL,
    "tamaño" bigint NOT NULL,
    titulo text,
    created_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone,
    id_tipo integer,
    allowed_roles text[] DEFAULT '{}'::text[],
    created_by integer,
    uso public.archivo_uso_enum DEFAULT 'EMPRESA'::public.archivo_uso_enum NOT NULL,
    id_carpeta integer
);



--
-- Name: archivos_actividades; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.archivos_actividades (
    id integer NOT NULL,
    actividad_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: archivos_actividades_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.archivos_actividades_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: archivos_actividades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.archivos_actividades_id_seq OWNED BY public.archivos_actividades.id;


--
-- Name: archivos_asociados_usuario; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.archivos_asociados_usuario (
    archivo_id integer NOT NULL,
    usuario_id integer NOT NULL
);



--
-- Name: archivos_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.archivos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: archivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.archivos_id_seq OWNED BY public.archivos.id;


--
-- Name: archivos_objetivos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.archivos_objetivos (
    id integer NOT NULL,
    objetivo_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: archivos_objetivos_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.archivos_objetivos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: archivos_objetivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.archivos_objetivos_id_seq OWNED BY public.archivos_objetivos.id;


--
-- Name: archivos_solicitudes; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.archivos_solicitudes (
    id integer NOT NULL,
    solicitud_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: archivos_solicitudes_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.archivos_solicitudes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: archivos_solicitudes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.archivos_solicitudes_id_seq OWNED BY public.archivos_solicitudes.id;


--
-- Name: archivos_tipos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.archivos_tipos (
    id integer NOT NULL,
    nombre text NOT NULL
);



--
-- Name: archivos_tipos_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.archivos_tipos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: archivos_tipos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.archivos_tipos_id_seq OWNED BY public.archivos_tipos.id;


--
-- Name: archivos_visibilidad_usuario; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.archivos_visibilidad_usuario (
    archivo_id integer NOT NULL,
    usuario_id integer NOT NULL
);



--
-- Name: articulo_imagen; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.articulo_imagen (
    id integer NOT NULL,
    articulo_id integer NOT NULL,
    image_id integer NOT NULL,
    orden integer DEFAULT 1,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone
);



--
-- Name: articulo_imagen_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.articulo_imagen_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: articulo_imagen_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.articulo_imagen_id_seq OWNED BY public.articulo_imagen.id;


--
-- Name: articulos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.articulos (
    codigo_articulo integer NOT NULL,
    descripcion character varying(40) NOT NULL,
    cod_barra_articulo bigint NOT NULL,
    cod_barra_caja bigint NOT NULL,
    cant_unidades_caja integer NOT NULL,
    precio_costo numeric(11,3) NOT NULL,
    precio_venta numeric(11,3) NOT NULL,
    precio_venta_volumen numeric(11,3) NOT NULL,
    stock_actual integer NOT NULL,
    updated_at timestamp without time zone,
    rentabilidad_minima numeric(5,4) DEFAULT 0 NOT NULL,
    deleted_at timestamp without time zone,
    rubro character varying(50),
    CONSTRAINT articulos_cant_unidades_caja_check CHECK ((cant_unidades_caja > 0)),
    CONSTRAINT articulos_precio_costo_check CHECK ((precio_costo >= (0)::numeric)),
    CONSTRAINT articulos_precio_venta_check CHECK ((precio_venta >= (0)::numeric)),
    CONSTRAINT articulos_precio_venta_volumen_check CHECK ((precio_venta_volumen >= (0)::numeric)),
    CONSTRAINT articulos_rentabilidad_minima_check CHECK (((rentabilidad_minima >= (0)::numeric) AND (rentabilidad_minima <= (1)::numeric))),
    CONSTRAINT articulos_stock_actual_check CHECK ((stock_actual >= 0))
);



--
-- Name: articulos_codigo_articulo_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.articulos_codigo_articulo_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: articulos_codigo_articulo_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.articulos_codigo_articulo_seq OWNED BY public.articulos.codigo_articulo;


--
-- Name: carpeta_visibilidad_usuario; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.carpeta_visibilidad_usuario (
    id integer NOT NULL,
    id_carpeta integer NOT NULL,
    id_usuario integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);



--
-- Name: carpeta_visibilidad_usuario_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.carpeta_visibilidad_usuario_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: carpeta_visibilidad_usuario_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.carpeta_visibilidad_usuario_id_seq OWNED BY public.carpeta_visibilidad_usuario.id;


--
-- Name: carpetas; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.carpetas (
    id integer NOT NULL,
    nombre character varying(255) NOT NULL,
    id_carpeta_padre integer,
    id_usuario integer NOT NULL,
    allowed_roles text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone
);



--
-- Name: carpetas_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.carpetas_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: carpetas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.carpetas_id_seq OWNED BY public.carpetas.id;


--
-- Name: cat_tipos_pregunta; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.cat_tipos_pregunta (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    descripcion text
);



--
-- Name: cat_tipos_pregunta_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.cat_tipos_pregunta_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: cat_tipos_pregunta_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.cat_tipos_pregunta_id_seq OWNED BY public.cat_tipos_pregunta.id;


--
-- Name: clientes; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.clientes (
    id_cliente integer NOT NULL,
    descripcion character varying(100) NOT NULL,
    direccion character varying(100),
    cuit character varying(20) NOT NULL,
    id_condicion_iva integer NOT NULL,
    observacion character varying(60),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone,
    deleted_at timestamp without time zone,
    id_localidad integer
);



--
-- Name: clientes_id_cliente_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.clientes_id_cliente_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: clientes_id_cliente_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.clientes_id_cliente_seq OWNED BY public.clientes.id_cliente;


--
-- Name: condiciones_iva; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.condiciones_iva (
    id_condicion integer NOT NULL,
    descripcion character varying(50) NOT NULL
);



--
-- Name: condiciones_iva_id_condicion_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.condiciones_iva_id_condicion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: condiciones_iva_id_condicion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.condiciones_iva_id_condicion_seq OWNED BY public.condiciones_iva.id_condicion;


--
-- Name: condiciones_venta; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.condiciones_venta (
    id_condicion integer NOT NULL,
    descripcion character varying(50) NOT NULL
);



--
-- Name: condiciones_venta_id_condicion_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.condiciones_venta_id_condicion_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: condiciones_venta_id_condicion_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.condiciones_venta_id_condicion_seq OWNED BY public.condiciones_venta.id_condicion;


--
-- Name: devices; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.devices (
    id integer NOT NULL,
    user_context_id integer NOT NULL,
    push_token character varying(500) NOT NULL,
    platform character varying(20) NOT NULL,
    device_name character varying(255),
    ip_address character varying(45),
    user_agent text,
    registered_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    last_active timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT devices_platform_check CHECK (((platform)::text = ANY ((ARRAY['ios'::character varying, 'android'::character varying, 'web'::character varying])::text[])))
);



--
-- Name: TABLE devices; Type: COMMENT; Schema: public; Owner: mateo
--

COMMENT ON TABLE public.devices IS 'Registro de dispositivos móviles para notificaciones push';


--
-- Name: COLUMN devices.push_token; Type: COMMENT; Schema: public; Owner: mateo
--

COMMENT ON COLUMN public.devices.push_token IS 'Token de Expo Push Notifications';


--
-- Name: COLUMN devices.platform; Type: COMMENT; Schema: public; Owner: mateo
--

COMMENT ON COLUMN public.devices.platform IS 'Plataforma del dispositivo: ios o android';


--
-- Name: devices_clockin; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.devices_clockin (
    id integer NOT NULL,
    user_context_id integer NOT NULL,
    device_id character varying(255) NOT NULL
);



--
-- Name: devices_clockin_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.devices_clockin_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: devices_clockin_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.devices_clockin_id_seq OWNED BY public.devices_clockin.id;


--
-- Name: devices_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.devices_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: devices_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.devices_id_seq OWNED BY public.devices.id;


--
-- Name: personal; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.personal (
    id_empleado integer NOT NULL,
    nombre character varying(255) NOT NULL,
    apellido character varying(255) NOT NULL,
    cuit character varying(20),
    direccion character varying(255),
    fecha_ingreso date DEFAULT CURRENT_DATE,
    activo boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    deleted_at timestamp without time zone,
    correo character varying
);



--
-- Name: empleados_id_empleado_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.empleados_id_empleado_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: empleados_id_empleado_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.empleados_id_empleado_seq OWNED BY public.personal.id_empleado;


--
-- Name: encuestas; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.encuestas (
    id integer NOT NULL,
    titulo character varying(255) NOT NULL,
    descripcion text,
    categoria public.tipo_categoria,
    es_anonima boolean DEFAULT false,
    fecha_creacion timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    fecha_fin timestamp without time zone,
    deleted_at timestamp without time zone,
    created_by integer NOT NULL
);



--
-- Name: encuestas_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.encuestas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: encuestas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.encuestas_id_seq OWNED BY public.encuestas.id;


--
-- Name: entidades_tipos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.entidades_tipos (
    id integer NOT NULL,
    nombre character varying(50) NOT NULL,
    origen character varying(50) NOT NULL
);



--
-- Name: entidades_tipos_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.entidades_tipos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: entidades_tipos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.entidades_tipos_id_seq OWNED BY public.entidades_tipos.id;


--
-- Name: enum_type_name; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.enum_type_name (
    typname name
);



--
-- Name: idempotency_records; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.idempotency_records (
    idempotency_key character varying(255) NOT NULL,
    id_solicitud integer,
    tipo_evento character varying(10),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);



--
-- Name: images; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.images (
    id integer NOT NULL,
    section text NOT NULL,
    url text NOT NULL,
    description text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone,
    cf_image_id text,
    storage_provider text DEFAULT 'cloudflare_r2_images'::text
);



--
-- Name: images_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.images_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: images_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.images_id_seq OWNED BY public.images.id;


--
-- Name: localidades; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.localidades (
    id_localidad integer NOT NULL,
    nombre character varying(100) NOT NULL,
    codigo_postal character varying(20),
    zona character varying(50) NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);



--
-- Name: localidades_id_localidad_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.localidades_id_localidad_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: localidades_id_localidad_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.localidades_id_localidad_seq OWNED BY public.localidades.id_localidad;


--
-- Name: logs; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.logs (
    id integer NOT NULL,
    tabla text NOT NULL,
    id_registro integer,
    operacion text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT logs_operacion_check CHECK ((operacion = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])))
);



--
-- Name: logs_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.logs_id_seq OWNED BY public.logs.id;


--
-- Name: notification_logs; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.notification_logs (
    id integer NOT NULL,
    device_id integer,
    user_context_id integer NOT NULL,
    title character varying(255),
    body text NOT NULL,
    data jsonb,
    status character varying(50) DEFAULT 'pending'::character varying,
    expo_ticket_id character varying(255),
    expo_receipt_id character varying(255),
    error_message text,
    sent_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    delivered_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT notification_logs_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'sent'::character varying, 'delivered'::character varying, 'error'::character varying])::text[])))
);



--
-- Name: TABLE notification_logs; Type: COMMENT; Schema: public; Owner: mateo
--

COMMENT ON TABLE public.notification_logs IS 'Log de notificaciones push enviadas';


--
-- Name: COLUMN notification_logs.expo_ticket_id; Type: COMMENT; Schema: public; Owner: mateo
--

COMMENT ON COLUMN public.notification_logs.expo_ticket_id IS 'ID de ticket devuelto por Expo al enviar';


--
-- Name: COLUMN notification_logs.expo_receipt_id; Type: COMMENT; Schema: public; Owner: mateo
--

COMMENT ON COLUMN public.notification_logs.expo_receipt_id IS 'ID de receipt para verificar entrega';


--
-- Name: notification_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.notification_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: notification_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.notification_logs_id_seq OWNED BY public.notification_logs.id;


--
-- Name: novedades; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.novedades (
    id integer NOT NULL,
    titulo text NOT NULL,
    descripcion text,
    id_etiqueta integer,
    prioridad smallint DEFAULT 3,
    created_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone,
    created_by integer
);



--
-- Name: novedades_etiquetas; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.novedades_etiquetas (
    id integer NOT NULL,
    nombre text NOT NULL
);



--
-- Name: novedades_etiquetas_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.novedades_etiquetas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: novedades_etiquetas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.novedades_etiquetas_id_seq OWNED BY public.novedades_etiquetas.id;


--
-- Name: novedades_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.novedades_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: novedades_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.novedades_id_seq OWNED BY public.novedades.id;


--
-- Name: objetivos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.objetivos (
    id integer NOT NULL,
    titulo character varying(255) NOT NULL,
    descripcion text,
    estado character varying(50) DEFAULT 'PENDIENTE'::character varying NOT NULL,
    rank_position character varying(255) DEFAULT ''::character varying NOT NULL,
    created_by integer NOT NULL,
    updated_by integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    solicitud_id integer
);



--
-- Name: objetivos_bitacora; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.objetivos_bitacora (
    id integer NOT NULL,
    objetivo_id integer NOT NULL,
    usuario_id integer NOT NULL,
    estado_anterior character varying(50),
    estado_nuevo character varying(50),
    observacion text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    asignee integer,
    appointment public.objetivo_bitacora_assign
);



--
-- Name: objetivos_bitacora_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.objetivos_bitacora_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: objetivos_bitacora_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.objetivos_bitacora_id_seq OWNED BY public.objetivos_bitacora.id;


--
-- Name: objetivos_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.objetivos_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: objetivos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.objetivos_id_seq OWNED BY public.objetivos.id;


--
-- Name: objetivos_usuarios; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.objetivos_usuarios (
    id integer NOT NULL,
    objetivo_id integer NOT NULL,
    user_context_id integer NOT NULL,
    rol public.objetivo_usuario_rol DEFAULT 'VISUALIZER'::public.objetivo_usuario_rol NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);



--
-- Name: objetivos_usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.objetivos_usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: objetivos_usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.objetivos_usuarios_id_seq OWNED BY public.objetivos_usuarios.id;


--
-- Name: opciones; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.opciones (
    id integer NOT NULL,
    pregunta_id integer,
    texto_opcion character varying(255) NOT NULL
);



--
-- Name: opciones_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.opciones_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: opciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.opciones_id_seq OWNED BY public.opciones.id;


--
-- Name: pagos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.pagos (
    id_pago integer NOT NULL,
    nro_pedido integer NOT NULL,
    medio_pago character varying(50) NOT NULL,
    monto numeric(11,3) NOT NULL,
    fecha_pago timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    referencia character varying(100),
    estado_pago character varying(20) DEFAULT 'pendiente'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    deleted_at timestamp without time zone,
    CONSTRAINT pagos_monto_check CHECK ((monto > (0)::numeric))
);



--
-- Name: pagos_id_pago_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.pagos_id_pago_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: pagos_id_pago_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.pagos_id_pago_seq OWNED BY public.pagos.id_pago;


--
-- Name: pedido_articulo; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.pedido_articulo (
    id integer NOT NULL,
    nro_pedido integer NOT NULL,
    codigo_articulo integer NOT NULL,
    cantidad integer NOT NULL,
    precio_unitario numeric(11,3) NOT NULL,
    tipo_operacion character varying(20) DEFAULT 'venta'::character varying NOT NULL,
    codigo_articulo_reemplazo integer,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    fecha_entrega timestamp without time zone,
    deleted_at timestamp without time zone,
    CONSTRAINT pedido_articulo_cantidad_check CHECK ((cantidad > 0)),
    CONSTRAINT pedido_articulo_precio_unitario_check CHECK ((precio_unitario >= (0)::numeric)),
    CONSTRAINT pedido_articulo_tipo_operacion_check CHECK (((tipo_operacion)::text = ANY (ARRAY[('venta'::character varying)::text, ('devolucion'::character varying)::text, ('reemplazo'::character varying)::text])))
);



--
-- Name: pedido_articulo_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.pedido_articulo_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: pedido_articulo_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.pedido_articulo_id_seq OWNED BY public.pedido_articulo.id;


--
-- Name: pedidos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.pedidos (
    nro_pedido integer NOT NULL,
    id_cliente integer NOT NULL,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    estado character varying(20) NOT NULL,
    id_condicion integer NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp without time zone,
    deleted_at timestamp without time zone,
    CONSTRAINT pedidos_estado_check CHECK (((estado)::text = ANY (ARRAY[('pendiente'::character varying)::text, ('preparado'::character varying)::text, ('entregado'::character varying)::text, ('cancelado'::character varying)::text])))
);



--
-- Name: pedidos_nro_pedido_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.pedidos_nro_pedido_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: pedidos_nro_pedido_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.pedidos_nro_pedido_seq OWNED BY public.pedidos.nro_pedido;


--
-- Name: planificacion_diaria; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.planificacion_diaria (
    id bigint NOT NULL,
    user_context_id integer NOT NULL,
    fecha date NOT NULL,
    turno public.turno_enum NOT NULL,
    modificado_manualmente boolean DEFAULT false,
    esperado_in timestamp without time zone,
    esperado_out timestamp without time zone,
    sede_id_in integer,
    sede_id_out integer
);



--
-- Name: planificacion_diaria_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.planificacion_diaria_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: planificacion_diaria_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.planificacion_diaria_id_seq OWNED BY public.planificacion_diaria.id;


--
-- Name: preguntas; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.preguntas (
    id integer NOT NULL,
    encuesta_id integer,
    titulo text NOT NULL,
    tipo_pregunta character varying(30),
    orden integer,
    es_obligatoria boolean DEFAULT true
);



--
-- Name: preguntas_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.preguntas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: preguntas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.preguntas_id_seq OWNED BY public.preguntas.id;


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.refresh_tokens (
    id integer NOT NULL,
    token text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    expires_at timestamp without time zone NOT NULL,
    revoked boolean DEFAULT false,
    id_usuario_entidad integer NOT NULL
);



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.refresh_tokens_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.refresh_tokens_id_seq OWNED BY public.refresh_tokens.id;


--
-- Name: reporte_actividad; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.reporte_actividad (
    id integer NOT NULL,
    reporte_id integer NOT NULL,
    usuario_id integer,
    tipo_accion character varying(50) NOT NULL,
    observacion text,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: reporte_actividad_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.reporte_actividad_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: reporte_actividad_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.reporte_actividad_id_seq OWNED BY public.reporte_actividad.id;


--
-- Name: reporte_imagen; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.reporte_imagen (
    id integer NOT NULL,
    reporte_id integer NOT NULL,
    image_id integer NOT NULL,
    orden integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone
);



--
-- Name: reporte_imagen_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.reporte_imagen_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: reporte_imagen_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.reporte_imagen_id_seq OWNED BY public.reporte_imagen.id;


--
-- Name: reportes; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.reportes (
    id integer NOT NULL,
    usuario_reportado_id integer NOT NULL,
    creador_id integer,
    titulo character varying(150) NOT NULL,
    descripcion text NOT NULL,
    categoria public.categoria_reportes,
    estado public.estado_reporte NOT NULL,
    fecha_incidente timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone
);



--
-- Name: reportes_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.reportes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: reportes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.reportes_id_seq OWNED BY public.reportes.id;


--
-- Name: respuestas; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.respuestas (
    id integer NOT NULL,
    pregunta_id integer,
    opcion_id integer,
    respuesta_texto text,
    valor_rating integer,
    evaluado_id integer,
    evaluado_tipo character varying(50),
    fecha_respuesta timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    usuario_id integer
);



--
-- Name: respuestas_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.respuestas_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: respuestas_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.respuestas_id_seq OWNED BY public.respuestas.id;


--
-- Name: roles; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.roles (
    id_rol integer NOT NULL,
    nombre text NOT NULL
);



--
-- Name: roles_id_rol_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.roles_id_rol_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: roles_id_rol_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.roles_id_rol_seq OWNED BY public.roles.id_rol;


--
-- Name: saldos_ausencia; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.saldos_ausencia (
    id integer NOT NULL,
    usuario_id integer NOT NULL,
    tipo_licencia_id integer NOT NULL,
    anio integer NOT NULL,
    dias_otorgados integer DEFAULT 0 NOT NULL,
    dias_consumidos integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    residuo integer DEFAULT 0
);



--
-- Name: saldos_ausencia_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.saldos_ausencia_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: saldos_ausencia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.saldos_ausencia_id_seq OWNED BY public.saldos_ausencia.id;


--
-- Name: saldos_francos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.saldos_francos (
    user_context_id integer NOT NULL,
    horas_disponibles numeric(10,2) DEFAULT 0.00,
    horas_consumidas numeric(10,2) DEFAULT 0.00
);



--
-- Name: scans; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.scans (
    id bigint NOT NULL,
    user_context_id integer NOT NULL,
    created_at timestamp without time zone NOT NULL,
    latitud numeric(10,6) NOT NULL,
    longitud numeric(10,6) NOT NULL,
    tipo_scan character varying(10)
);



--
-- Name: scans_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.scans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: scans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.scans_id_seq OWNED BY public.scans.id;


--
-- Name: sedes; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.sedes (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    ubicacion public.geography(Point,4326) NOT NULL,
    radio_permitido_metros integer DEFAULT 50,
    activo boolean DEFAULT true,
    codigo_qr character varying(255)
);



--
-- Name: sedes_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.sedes_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: sedes_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.sedes_id_seq OWNED BY public.sedes.id;


--
-- Name: solicitudes; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.solicitudes (
    solicitud_id integer NOT NULL,
    titulo text NOT NULL,
    descripcion text,
    created_at timestamp without time zone DEFAULT now(),
    created_by integer NOT NULL,
    fecha_inicio timestamp without time zone,
    fecha_fin timestamp without time zone,
    tipo_actividad public.tipo_actividad DEFAULT 'REUNION'::public.tipo_actividad,
    deleted_at timestamp without time zone
);



--
-- Name: solicitudes_archivos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.solicitudes_archivos (
    solicitud_id integer NOT NULL,
    archivo_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: solicitudes_ausencia; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.solicitudes_ausencia (
    id integer NOT NULL,
    usuario_id integer NOT NULL,
    tipo_licencia_id integer NOT NULL,
    fecha_inicio timestamp without time zone NOT NULL,
    fecha_fin timestamp without time zone NOT NULL,
    cantidad_dias integer,
    estado public.estado_solicitud DEFAULT 'PENDIENTE'::public.estado_solicitud NOT NULL,
    aprobador_id integer,
    fecha_respuesta timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone,
    residuo_al_aprobar integer DEFAULT 0,
    observacion_solicitud text,
    observacion_respuesta text,
    cantidad_horas integer
);



--
-- Name: solicitudes_ausencia_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.solicitudes_ausencia_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: solicitudes_ausencia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.solicitudes_ausencia_id_seq OWNED BY public.solicitudes_ausencia.id;


--
-- Name: solicitudes_bitacora; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.solicitudes_bitacora (
    id integer NOT NULL,
    solicitud_id integer NOT NULL,
    usuario_id integer NOT NULL,
    fecha_inicio_nueva timestamp without time zone,
    fecha_fin_nueva timestamp without time zone,
    observacion text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    estado public.estado_invitacion,
    deleted_at timestamp without time zone
);



--
-- Name: solicitudes_bitacora_archivo; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.solicitudes_bitacora_archivo (
    bitacora_id bigint NOT NULL,
    archivo_id bigint NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: solicitudes_bitacora_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.solicitudes_bitacora_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: solicitudes_bitacora_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.solicitudes_bitacora_id_seq OWNED BY public.solicitudes_bitacora.id;


--
-- Name: solicitudes_invitados; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.solicitudes_invitados (
    id_solicitud integer NOT NULL,
    id_usuario_invitado integer NOT NULL,
    estado public.estado_invitacion DEFAULT 'SENT'::public.estado_invitacion,
    deleted_at timestamp without time zone
);



--
-- Name: solicitudes_solicitud_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.solicitudes_solicitud_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: solicitudes_solicitud_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.solicitudes_solicitud_id_seq OWNED BY public.solicitudes.solicitud_id;


--
-- Name: suscripciones; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.suscripciones (
    id integer NOT NULL,
    nombre text NOT NULL,
    telefono text,
    email text NOT NULL,
    localidad text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone
);



--
-- Name: suscripciones_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.suscripciones_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: suscripciones_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.suscripciones_id_seq OWNED BY public.suscripciones.id;


--
-- Name: telefonos; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.telefonos (
    id_telefono integer NOT NULL,
    id_cliente integer,
    telefono character varying(30) NOT NULL,
    tipo character varying(20),
    id_personal integer
);



--
-- Name: telefonos_id_telefono_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.telefonos_id_telefono_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: telefonos_id_telefono_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.telefonos_id_telefono_seq OWNED BY public.telefonos.id_telefono;


--
-- Name: tipos_licencia; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.tipos_licencia (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    codigo character varying(50) NOT NULL,
    descripcion text,
    requiere_saldo boolean DEFAULT false,
    requiere_adjunto boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);



--
-- Name: tipos_licencia_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.tipos_licencia_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: tipos_licencia_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.tipos_licencia_id_seq OWNED BY public.tipos_licencia.id;


--
-- Name: usuario_entidad; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.usuario_entidad (
    id integer NOT NULL,
    id_usuario integer NOT NULL,
    id_entidad_tipo integer NOT NULL,
    id_entidad integer NOT NULL,
    fecha_asociacion timestamp without time zone DEFAULT now(),
    id_rol integer NOT NULL
);



--
-- Name: usuario_entidad_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.usuario_entidad_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: usuario_entidad_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.usuario_entidad_id_seq OWNED BY public.usuario_entidad.id;


--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    email text NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone,
    deleted_at timestamp without time zone,
    nombre character varying(100) NOT NULL,
    apellido character varying(100) NOT NULL
);



--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: v_usuario_entidad_completo; Type: VIEW; Schema: public; Owner: mateo
--

CREATE VIEW public.v_usuario_entidad_completo AS
 SELECT ue.id AS user_context_id,
    ue.id_usuario,
    ue.id_entidad_tipo,
    ue.id_entidad,
    ue.id_rol,
    ue.fecha_asociacion,
    u.username,
    u.email,
    u.nombre,
    u.apellido,
    u.created_at AS usuario_created_at,
    u.updated_at AS usuario_updated_at,
    et.nombre AS entidad_tipo_nombre,
    et.origen AS entorno,
    r.nombre AS rol_nombre
   FROM (((public.usuario_entidad ue
     JOIN public.usuarios u ON ((ue.id_usuario = u.id)))
     JOIN public.entidades_tipos et ON ((ue.id_entidad_tipo = et.id)))
     JOIN public.roles r ON ((ue.id_rol = r.id_rol)))
  WHERE (u.deleted_at IS NULL);



--
-- Name: v_interno_users; Type: VIEW; Schema: public; Owner: mateo
--

CREATE VIEW public.v_interno_users AS
 SELECT user_context_id,
    id_usuario,
    id_entidad_tipo,
    id_entidad,
    id_rol,
    fecha_asociacion,
    username,
    email,
    nombre,
    apellido,
    usuario_created_at,
    usuario_updated_at,
    entidad_tipo_nombre,
    entorno,
    rol_nombre
   FROM public.v_usuario_entidad_completo
  WHERE ((entorno)::text = 'interno'::text);



--
-- Name: v_mayorista_users; Type: VIEW; Schema: public; Owner: mateo
--

CREATE VIEW public.v_mayorista_users AS
 SELECT user_context_id,
    id_usuario,
    id_entidad_tipo,
    id_entidad,
    id_rol,
    fecha_asociacion,
    username,
    email,
    nombre,
    apellido,
    usuario_created_at,
    usuario_updated_at,
    entidad_tipo_nombre,
    entorno,
    rol_nombre
   FROM public.v_usuario_entidad_completo
  WHERE ((entorno)::text = 'mayorista'::text);



--
-- Name: v_web_users; Type: VIEW; Schema: public; Owner: mateo
--

CREATE VIEW public.v_web_users AS
 SELECT user_context_id,
    id_usuario,
    id_entidad_tipo,
    id_entidad,
    id_rol,
    fecha_asociacion,
    username,
    email,
    nombre,
    apellido,
    usuario_created_at,
    usuario_updated_at,
    entidad_tipo_nombre,
    entorno,
    rol_nombre
   FROM public.v_usuario_entidad_completo
  WHERE ((entorno)::text = 'web'::text);



--
-- Name: verification_tokens; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.verification_tokens (
    id integer NOT NULL,
    user_id integer NOT NULL,
    contact text NOT NULL,
    token text NOT NULL,
    method text NOT NULL,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    revoked boolean,
    created_by integer,
    purpose public.token_purpose
);



--
-- Name: verification_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.verification_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: verification_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.verification_tokens_id_seq OWNED BY public.verification_tokens.id;


--
-- Name: visitas; Type: TABLE; Schema: public; Owner: mateo
--

CREATE TABLE public.visitas (
    id_visita integer NOT NULL,
    id_cliente integer NOT NULL,
    fecha_visita date DEFAULT CURRENT_DATE NOT NULL,
    resultado public.estado_visita_enum NOT NULL,
    observacion_visita text,
    proxima_visita date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp without time zone,
    updated_at timestamp without time zone
);



--
-- Name: visitas_id_visita_seq; Type: SEQUENCE; Schema: public; Owner: mateo
--

CREATE SEQUENCE public.visitas_id_visita_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;



--
-- Name: visitas_id_visita_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: mateo
--

ALTER SEQUENCE public.visitas_id_visita_seq OWNED BY public.visitas.id_visita;


--
-- Name: actividades id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.actividades ALTER COLUMN id SET DEFAULT nextval('public.actividades_id_seq'::regclass);


--
-- Name: archivos id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos ALTER COLUMN id SET DEFAULT nextval('public.archivos_id_seq'::regclass);


--
-- Name: archivos_actividades id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_actividades ALTER COLUMN id SET DEFAULT nextval('public.archivos_actividades_id_seq'::regclass);


--
-- Name: archivos_objetivos id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_objetivos ALTER COLUMN id SET DEFAULT nextval('public.archivos_objetivos_id_seq'::regclass);


--
-- Name: archivos_solicitudes id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_solicitudes ALTER COLUMN id SET DEFAULT nextval('public.archivos_solicitudes_id_seq'::regclass);


--
-- Name: archivos_tipos id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_tipos ALTER COLUMN id SET DEFAULT nextval('public.archivos_tipos_id_seq'::regclass);


--
-- Name: articulo_imagen id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.articulo_imagen ALTER COLUMN id SET DEFAULT nextval('public.articulo_imagen_id_seq'::regclass);


--
-- Name: articulos codigo_articulo; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.articulos ALTER COLUMN codigo_articulo SET DEFAULT nextval('public.articulos_codigo_articulo_seq'::regclass);


--
-- Name: carpeta_visibilidad_usuario id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpeta_visibilidad_usuario ALTER COLUMN id SET DEFAULT nextval('public.carpeta_visibilidad_usuario_id_seq'::regclass);


--
-- Name: carpetas id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpetas ALTER COLUMN id SET DEFAULT nextval('public.carpetas_id_seq'::regclass);


--
-- Name: cat_tipos_pregunta id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.cat_tipos_pregunta ALTER COLUMN id SET DEFAULT nextval('public.cat_tipos_pregunta_id_seq'::regclass);


--
-- Name: clientes id_cliente; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.clientes ALTER COLUMN id_cliente SET DEFAULT nextval('public.clientes_id_cliente_seq'::regclass);


--
-- Name: condiciones_iva id_condicion; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.condiciones_iva ALTER COLUMN id_condicion SET DEFAULT nextval('public.condiciones_iva_id_condicion_seq'::regclass);


--
-- Name: condiciones_venta id_condicion; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.condiciones_venta ALTER COLUMN id_condicion SET DEFAULT nextval('public.condiciones_venta_id_condicion_seq'::regclass);


--
-- Name: devices id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.devices ALTER COLUMN id SET DEFAULT nextval('public.devices_id_seq'::regclass);


--
-- Name: devices_clockin id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.devices_clockin ALTER COLUMN id SET DEFAULT nextval('public.devices_clockin_id_seq'::regclass);


--
-- Name: encuestas id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.encuestas ALTER COLUMN id SET DEFAULT nextval('public.encuestas_id_seq'::regclass);


--
-- Name: entidades_tipos id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.entidades_tipos ALTER COLUMN id SET DEFAULT nextval('public.entidades_tipos_id_seq'::regclass);


--
-- Name: images id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.images ALTER COLUMN id SET DEFAULT nextval('public.images_id_seq'::regclass);


--
-- Name: localidades id_localidad; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.localidades ALTER COLUMN id_localidad SET DEFAULT nextval('public.localidades_id_localidad_seq'::regclass);


--
-- Name: logs id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.logs ALTER COLUMN id SET DEFAULT nextval('public.logs_id_seq'::regclass);


--
-- Name: notification_logs id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.notification_logs ALTER COLUMN id SET DEFAULT nextval('public.notification_logs_id_seq'::regclass);


--
-- Name: novedades id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.novedades ALTER COLUMN id SET DEFAULT nextval('public.novedades_id_seq'::regclass);


--
-- Name: novedades_etiquetas id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.novedades_etiquetas ALTER COLUMN id SET DEFAULT nextval('public.novedades_etiquetas_id_seq'::regclass);


--
-- Name: objetivos id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos ALTER COLUMN id SET DEFAULT nextval('public.objetivos_id_seq'::regclass);


--
-- Name: objetivos_bitacora id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_bitacora ALTER COLUMN id SET DEFAULT nextval('public.objetivos_bitacora_id_seq'::regclass);


--
-- Name: objetivos_usuarios id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_usuarios ALTER COLUMN id SET DEFAULT nextval('public.objetivos_usuarios_id_seq'::regclass);


--
-- Name: opciones id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.opciones ALTER COLUMN id SET DEFAULT nextval('public.opciones_id_seq'::regclass);


--
-- Name: pagos id_pago; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pagos ALTER COLUMN id_pago SET DEFAULT nextval('public.pagos_id_pago_seq'::regclass);


--
-- Name: pedido_articulo id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedido_articulo ALTER COLUMN id SET DEFAULT nextval('public.pedido_articulo_id_seq'::regclass);


--
-- Name: pedidos nro_pedido; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedidos ALTER COLUMN nro_pedido SET DEFAULT nextval('public.pedidos_nro_pedido_seq'::regclass);


--
-- Name: personal id_empleado; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.personal ALTER COLUMN id_empleado SET DEFAULT nextval('public.empleados_id_empleado_seq'::regclass);


--
-- Name: planificacion_diaria id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.planificacion_diaria ALTER COLUMN id SET DEFAULT nextval('public.planificacion_diaria_id_seq'::regclass);


--
-- Name: preguntas id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.preguntas ALTER COLUMN id SET DEFAULT nextval('public.preguntas_id_seq'::regclass);


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('public.refresh_tokens_id_seq'::regclass);


--
-- Name: reporte_actividad id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_actividad ALTER COLUMN id SET DEFAULT nextval('public.reporte_actividad_id_seq'::regclass);


--
-- Name: reporte_imagen id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_imagen ALTER COLUMN id SET DEFAULT nextval('public.reporte_imagen_id_seq'::regclass);


--
-- Name: reportes id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reportes ALTER COLUMN id SET DEFAULT nextval('public.reportes_id_seq'::regclass);


--
-- Name: respuestas id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.respuestas ALTER COLUMN id SET DEFAULT nextval('public.respuestas_id_seq'::regclass);


--
-- Name: roles id_rol; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.roles ALTER COLUMN id_rol SET DEFAULT nextval('public.roles_id_rol_seq'::regclass);


--
-- Name: saldos_ausencia id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.saldos_ausencia ALTER COLUMN id SET DEFAULT nextval('public.saldos_ausencia_id_seq'::regclass);


--
-- Name: scans id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.scans ALTER COLUMN id SET DEFAULT nextval('public.scans_id_seq'::regclass);


--
-- Name: sedes id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.sedes ALTER COLUMN id SET DEFAULT nextval('public.sedes_id_seq'::regclass);


--
-- Name: solicitudes solicitud_id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes ALTER COLUMN solicitud_id SET DEFAULT nextval('public.solicitudes_solicitud_id_seq'::regclass);


--
-- Name: solicitudes_ausencia id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_ausencia ALTER COLUMN id SET DEFAULT nextval('public.solicitudes_ausencia_id_seq'::regclass);


--
-- Name: solicitudes_bitacora id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_bitacora ALTER COLUMN id SET DEFAULT nextval('public.solicitudes_bitacora_id_seq'::regclass);


--
-- Name: suscripciones id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.suscripciones ALTER COLUMN id SET DEFAULT nextval('public.suscripciones_id_seq'::regclass);


--
-- Name: telefonos id_telefono; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.telefonos ALTER COLUMN id_telefono SET DEFAULT nextval('public.telefonos_id_telefono_seq'::regclass);


--
-- Name: tipos_licencia id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.tipos_licencia ALTER COLUMN id SET DEFAULT nextval('public.tipos_licencia_id_seq'::regclass);


--
-- Name: usuario_entidad id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuario_entidad ALTER COLUMN id SET DEFAULT nextval('public.usuario_entidad_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Name: verification_tokens id; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.verification_tokens ALTER COLUMN id SET DEFAULT nextval('public.verification_tokens_id_seq'::regclass);


--
-- Name: visitas id_visita; Type: DEFAULT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.visitas ALTER COLUMN id_visita SET DEFAULT nextval('public.visitas_id_visita_seq'::regclass);


--
-- Data for Name: actividades; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: actividades_participantes; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: archivo_aperturas; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: archivos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: archivos_actividades; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: archivos_asociados_usuario; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: archivos_objetivos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: archivos_solicitudes; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: archivos_tipos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: archivos_visibilidad_usuario; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: articulo_imagen; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: articulos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: carpeta_visibilidad_usuario; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: carpetas; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: cat_tipos_pregunta; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: clientes; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: condiciones_iva; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: condiciones_venta; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: devices; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: devices_clockin; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: encuestas; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: entidades_tipos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: enum_type_name; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: idempotency_records; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: images; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: localidades; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: logs; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: notification_logs; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: novedades; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: novedades_etiquetas; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: objetivos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: objetivos_bitacora; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: objetivos_usuarios; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: opciones; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: pagos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: pedido_articulo; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: pedidos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: personal; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: planificacion_diaria; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: preguntas; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: reporte_actividad; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: reporte_imagen; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: reportes; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: respuestas; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: saldos_ausencia; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: saldos_francos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: scans; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: sedes; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: solicitudes; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: solicitudes_archivos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: solicitudes_ausencia; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: solicitudes_bitacora; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: solicitudes_bitacora_archivo; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: solicitudes_invitados; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: spatial_ref_sys; Type: TABLE DATA; Schema: public; Owner: postgres
--



--
-- Data for Name: suscripciones; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: telefonos; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: tipos_licencia; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: usuario_entidad; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: usuarios; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: verification_tokens; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Data for Name: visitas; Type: TABLE DATA; Schema: public; Owner: mateo
--



--
-- Name: actividades_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: archivos_actividades_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: archivos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: archivos_objetivos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: archivos_solicitudes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: archivos_tipos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: articulo_imagen_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: articulos_codigo_articulo_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: carpeta_visibilidad_usuario_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: carpetas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: cat_tipos_pregunta_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: clientes_id_cliente_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: condiciones_iva_id_condicion_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: condiciones_venta_id_condicion_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: devices_clockin_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: devices_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: empleados_id_empleado_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: encuestas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: entidades_tipos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: images_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: localidades_id_localidad_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: notification_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: novedades_etiquetas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: novedades_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: objetivos_bitacora_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: objetivos_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: objetivos_usuarios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: opciones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: pagos_id_pago_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: pedido_articulo_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: pedidos_nro_pedido_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: planificacion_diaria_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: preguntas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: reporte_actividad_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: reporte_imagen_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: reportes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: respuestas_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: roles_id_rol_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: saldos_ausencia_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: scans_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: sedes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: solicitudes_ausencia_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: solicitudes_bitacora_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: solicitudes_solicitud_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: suscripciones_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: telefonos_id_telefono_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: tipos_licencia_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: usuario_entidad_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: usuarios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: verification_tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: visitas_id_visita_seq; Type: SEQUENCE SET; Schema: public; Owner: mateo
--



--
-- Name: actividades_participantes actividades_participantes_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.actividades_participantes
    ADD CONSTRAINT actividades_participantes_pkey PRIMARY KEY (id_actividad, id_usuario_participante);


--
-- Name: actividades actividades_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.actividades
    ADD CONSTRAINT actividades_pkey PRIMARY KEY (id);


--
-- Name: archivos_actividades archivos_actividades_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_actividades
    ADD CONSTRAINT archivos_actividades_pkey PRIMARY KEY (id);


--
-- Name: archivos_asociados_usuario archivos_asociados_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_asociados_usuario
    ADD CONSTRAINT archivos_asociados_usuario_pkey PRIMARY KEY (archivo_id, usuario_id);


--
-- Name: archivos_objetivos archivos_objetivos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_objetivos
    ADD CONSTRAINT archivos_objetivos_pkey PRIMARY KEY (id);


--
-- Name: archivos archivos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos
    ADD CONSTRAINT archivos_pkey PRIMARY KEY (id);


--
-- Name: archivos_solicitudes archivos_solicitudes_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_solicitudes
    ADD CONSTRAINT archivos_solicitudes_pkey PRIMARY KEY (id);


--
-- Name: archivos_tipos archivos_tipos_nombre_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_tipos
    ADD CONSTRAINT archivos_tipos_nombre_key UNIQUE (nombre);


--
-- Name: archivos_tipos archivos_tipos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_tipos
    ADD CONSTRAINT archivos_tipos_pkey PRIMARY KEY (id);


--
-- Name: archivos_visibilidad_usuario archivos_visibilidad_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_visibilidad_usuario
    ADD CONSTRAINT archivos_visibilidad_usuario_pkey PRIMARY KEY (archivo_id, usuario_id);


--
-- Name: articulo_imagen articulo_imagen_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.articulo_imagen
    ADD CONSTRAINT articulo_imagen_pkey PRIMARY KEY (id);


--
-- Name: articulos articulos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.articulos
    ADD CONSTRAINT articulos_pkey PRIMARY KEY (codigo_articulo);


--
-- Name: carpeta_visibilidad_usuario carpeta_visibilidad_usuario_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpeta_visibilidad_usuario
    ADD CONSTRAINT carpeta_visibilidad_usuario_pkey PRIMARY KEY (id);


--
-- Name: carpetas carpetas_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpetas
    ADD CONSTRAINT carpetas_pkey PRIMARY KEY (id);


--
-- Name: cat_tipos_pregunta cat_tipos_pregunta_nombre_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.cat_tipos_pregunta
    ADD CONSTRAINT cat_tipos_pregunta_nombre_key UNIQUE (nombre);


--
-- Name: cat_tipos_pregunta cat_tipos_pregunta_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.cat_tipos_pregunta
    ADD CONSTRAINT cat_tipos_pregunta_pkey PRIMARY KEY (id);


--
-- Name: clientes clientes_cuit_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_cuit_key UNIQUE (cuit);


--
-- Name: clientes clientes_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_pkey PRIMARY KEY (id_cliente);


--
-- Name: condiciones_iva condiciones_iva_descripcion_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.condiciones_iva
    ADD CONSTRAINT condiciones_iva_descripcion_key UNIQUE (descripcion);


--
-- Name: condiciones_iva condiciones_iva_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.condiciones_iva
    ADD CONSTRAINT condiciones_iva_pkey PRIMARY KEY (id_condicion);


--
-- Name: condiciones_venta condiciones_venta_descripcion_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.condiciones_venta
    ADD CONSTRAINT condiciones_venta_descripcion_key UNIQUE (descripcion);


--
-- Name: condiciones_venta condiciones_venta_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.condiciones_venta
    ADD CONSTRAINT condiciones_venta_pkey PRIMARY KEY (id_condicion);


--
-- Name: devices_clockin devices_clockin_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.devices_clockin
    ADD CONSTRAINT devices_clockin_pkey PRIMARY KEY (id);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: devices devices_push_token_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_push_token_key UNIQUE (push_token);


--
-- Name: personal empleados_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.personal
    ADD CONSTRAINT empleados_pkey PRIMARY KEY (id_empleado);


--
-- Name: encuestas encuestas_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.encuestas
    ADD CONSTRAINT encuestas_pkey PRIMARY KEY (id);


--
-- Name: entidades_tipos entidades_tipos_nombre_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.entidades_tipos
    ADD CONSTRAINT entidades_tipos_nombre_key UNIQUE (nombre);


--
-- Name: entidades_tipos entidades_tipos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.entidades_tipos
    ADD CONSTRAINT entidades_tipos_pkey PRIMARY KEY (id);


--
-- Name: idempotency_records idempotency_records_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.idempotency_records
    ADD CONSTRAINT idempotency_records_pkey PRIMARY KEY (idempotency_key);


--
-- Name: images images_cf_image_id_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.images
    ADD CONSTRAINT images_cf_image_id_key UNIQUE (cf_image_id);


--
-- Name: images images_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.images
    ADD CONSTRAINT images_pkey PRIMARY KEY (id);


--
-- Name: images images_url_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.images
    ADD CONSTRAINT images_url_key UNIQUE (url);


--
-- Name: localidades localidades_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.localidades
    ADD CONSTRAINT localidades_pkey PRIMARY KEY (id_localidad);


--
-- Name: logs logs_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (id);


--
-- Name: notification_logs notification_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_pkey PRIMARY KEY (id);


--
-- Name: novedades_etiquetas novedades_etiquetas_nombre_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.novedades_etiquetas
    ADD CONSTRAINT novedades_etiquetas_nombre_key UNIQUE (nombre);


--
-- Name: novedades_etiquetas novedades_etiquetas_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.novedades_etiquetas
    ADD CONSTRAINT novedades_etiquetas_pkey PRIMARY KEY (id);


--
-- Name: novedades novedades_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.novedades
    ADD CONSTRAINT novedades_pkey PRIMARY KEY (id);


--
-- Name: objetivos_bitacora objetivos_bitacora_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_bitacora
    ADD CONSTRAINT objetivos_bitacora_pkey PRIMARY KEY (id);


--
-- Name: objetivos objetivos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos
    ADD CONSTRAINT objetivos_pkey PRIMARY KEY (id);


--
-- Name: objetivos_usuarios objetivos_usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_usuarios
    ADD CONSTRAINT objetivos_usuarios_pkey PRIMARY KEY (id);


--
-- Name: opciones opciones_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.opciones
    ADD CONSTRAINT opciones_pkey PRIMARY KEY (id);


--
-- Name: pagos pagos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_pkey PRIMARY KEY (id_pago);


--
-- Name: pedido_articulo pedido_articulo_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedido_articulo
    ADD CONSTRAINT pedido_articulo_pkey PRIMARY KEY (id);


--
-- Name: pedido_articulo pedido_articulo_unique; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedido_articulo
    ADD CONSTRAINT pedido_articulo_unique UNIQUE (nro_pedido, codigo_articulo);


--
-- Name: pedidos pedidos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_pkey PRIMARY KEY (nro_pedido);


--
-- Name: planificacion_diaria planificacion_diaria_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.planificacion_diaria
    ADD CONSTRAINT planificacion_diaria_pkey PRIMARY KEY (id);


--
-- Name: preguntas preguntas_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.preguntas
    ADD CONSTRAINT preguntas_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: reporte_actividad reporte_actividad_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_actividad
    ADD CONSTRAINT reporte_actividad_pkey PRIMARY KEY (id);


--
-- Name: reporte_imagen reporte_imagen_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_imagen
    ADD CONSTRAINT reporte_imagen_pkey PRIMARY KEY (id);


--
-- Name: reporte_imagen reporte_imagen_reporte_id_image_id_deleted_at_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_imagen
    ADD CONSTRAINT reporte_imagen_reporte_id_image_id_deleted_at_key UNIQUE (reporte_id, image_id, deleted_at);


--
-- Name: reportes reportes_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reportes
    ADD CONSTRAINT reportes_pkey PRIMARY KEY (id);


--
-- Name: respuestas respuestas_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.respuestas
    ADD CONSTRAINT respuestas_pkey PRIMARY KEY (id);


--
-- Name: roles roles_nombre_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_nombre_key UNIQUE (nombre);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id_rol);


--
-- Name: saldos_ausencia saldos_ausencia_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.saldos_ausencia
    ADD CONSTRAINT saldos_ausencia_pkey PRIMARY KEY (id);


--
-- Name: saldos_ausencia saldos_ausencia_usuario_id_tipo_licencia_id_anio_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.saldos_ausencia
    ADD CONSTRAINT saldos_ausencia_usuario_id_tipo_licencia_id_anio_key UNIQUE (usuario_id, tipo_licencia_id, anio);


--
-- Name: saldos_francos saldos_francos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.saldos_francos
    ADD CONSTRAINT saldos_francos_pkey PRIMARY KEY (user_context_id);


--
-- Name: scans scans_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.scans
    ADD CONSTRAINT scans_pkey PRIMARY KEY (id);


--
-- Name: sedes sedes_codigo_qr_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.sedes
    ADD CONSTRAINT sedes_codigo_qr_key UNIQUE (codigo_qr);


--
-- Name: sedes sedes_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.sedes
    ADD CONSTRAINT sedes_pkey PRIMARY KEY (id);


--
-- Name: solicitudes_archivos solicitudes_archivos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_archivos
    ADD CONSTRAINT solicitudes_archivos_pkey PRIMARY KEY (solicitud_id, archivo_id);


--
-- Name: solicitudes_ausencia solicitudes_ausencia_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_ausencia
    ADD CONSTRAINT solicitudes_ausencia_pkey PRIMARY KEY (id);


--
-- Name: solicitudes_bitacora_archivo solicitudes_bitacora_archivo_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_bitacora_archivo
    ADD CONSTRAINT solicitudes_bitacora_archivo_pkey PRIMARY KEY (bitacora_id, archivo_id);


--
-- Name: solicitudes_bitacora solicitudes_bitacora_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_bitacora
    ADD CONSTRAINT solicitudes_bitacora_pkey PRIMARY KEY (id);


--
-- Name: solicitudes_invitados solicitudes_invitados_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_invitados
    ADD CONSTRAINT solicitudes_invitados_pkey PRIMARY KEY (id_solicitud, id_usuario_invitado);


--
-- Name: solicitudes solicitudes_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_pkey PRIMARY KEY (solicitud_id);


--
-- Name: suscripciones suscripciones_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.suscripciones
    ADD CONSTRAINT suscripciones_pkey PRIMARY KEY (id);


--
-- Name: telefonos telefonos_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.telefonos
    ADD CONSTRAINT telefonos_pkey PRIMARY KEY (id_telefono);


--
-- Name: tipos_licencia tipos_licencia_codigo_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.tipos_licencia
    ADD CONSTRAINT tipos_licencia_codigo_key UNIQUE (codigo);


--
-- Name: tipos_licencia tipos_licencia_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.tipos_licencia
    ADD CONSTRAINT tipos_licencia_pkey PRIMARY KEY (id);


--
-- Name: objetivos_usuarios uk_objetivo_usuario; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_usuarios
    ADD CONSTRAINT uk_objetivo_usuario UNIQUE (objetivo_id, user_context_id);


--
-- Name: respuestas unico_voto_por_usuario; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.respuestas
    ADD CONSTRAINT unico_voto_por_usuario UNIQUE (usuario_id, pregunta_id, evaluado_id);


--
-- Name: articulo_imagen unique_orden_por_articulo; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.articulo_imagen
    ADD CONSTRAINT unique_orden_por_articulo UNIQUE (articulo_id, orden);


--
-- Name: devices_clockin unique_user_device; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.devices_clockin
    ADD CONSTRAINT unique_user_device UNIQUE (device_id);


--
-- Name: planificacion_diaria unique_user_fecha_turno; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.planificacion_diaria
    ADD CONSTRAINT unique_user_fecha_turno UNIQUE (user_context_id, fecha, turno);


--
-- Name: devices unique_user_token; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT unique_user_token UNIQUE (user_context_id, push_token);


--
-- Name: archivo_aperturas uq_archivo_aperturas; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivo_aperturas
    ADD CONSTRAINT uq_archivo_aperturas UNIQUE (archivo_id, usuario_id);


--
-- Name: carpeta_visibilidad_usuario uq_carpeta_visibilidad; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpeta_visibilidad_usuario
    ADD CONSTRAINT uq_carpeta_visibilidad UNIQUE (id_carpeta, id_usuario);


--
-- Name: refresh_tokens uq_refresh_tokens_token; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT uq_refresh_tokens_token UNIQUE (token);


--
-- Name: verification_tokens uq_user_contact; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT uq_user_contact UNIQUE (user_id, contact, token);


--
-- Name: usuario_entidad usuario_entidad_id_usuario_id_entidad_id_entidad_tipo_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuario_entidad
    ADD CONSTRAINT usuario_entidad_id_usuario_id_entidad_id_entidad_tipo_key UNIQUE (id_usuario, id_entidad, id_entidad_tipo);


--
-- Name: usuario_entidad usuario_entidad_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuario_entidad
    ADD CONSTRAINT usuario_entidad_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_email_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_email_key UNIQUE (email);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_username_key; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_username_key UNIQUE (username);


--
-- Name: verification_tokens verification_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_pkey PRIMARY KEY (id);


--
-- Name: visitas visitas_pkey; Type: CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.visitas
    ADD CONSTRAINT visitas_pkey PRIMARY KEY (id_visita);


--
-- Name: idx_actividad_fecha; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_actividad_fecha ON public.actividades USING btree (fecha_inicio, fecha_fin);


--
-- Name: idx_actividades_notif_pendiente; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_actividades_notif_pendiente ON public.actividades USING btree (fecha_inicio) WHERE ((deleted_at IS NULL) AND (notificacion_enviada = false));


--
-- Name: idx_archivo_aperturas_usuario; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivo_aperturas_usuario ON public.archivo_aperturas USING btree (usuario_id);


--
-- Name: idx_archivos_actividades_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_actividades_id ON public.archivos_actividades USING btree (actividad_id);


--
-- Name: idx_archivos_allowed_roles; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_allowed_roles ON public.archivos USING gin (allowed_roles);


--
-- Name: idx_archivos_compartidos_usuario_usuario_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_compartidos_usuario_usuario_id ON public.archivos_visibilidad_usuario USING btree (usuario_id);


--
-- Name: idx_archivos_created_by; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_created_by ON public.archivos USING btree (created_by);


--
-- Name: idx_archivos_id_carpeta; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_id_carpeta ON public.archivos USING btree (id_carpeta) WHERE (deleted_at IS NULL);


--
-- Name: idx_archivos_not_deleted; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_not_deleted ON public.archivos USING btree (created_at) WHERE (deleted_at IS NULL);


--
-- Name: idx_archivos_objetivos_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_objetivos_id ON public.archivos_objetivos USING btree (objetivo_id);


--
-- Name: idx_archivos_search_vector; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_search_vector ON public.archivos USING gin (to_tsvector('spanish'::regconfig, (COALESCE(nombre, ''::text) || ' '::text)));


--
-- Name: idx_archivos_solicitudes_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_solicitudes_id ON public.solicitudes_archivos USING btree (solicitud_id);


--
-- Name: idx_archivos_uso; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_uso ON public.archivos USING btree (uso);


--
-- Name: idx_archivos_usuario_asociado; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_archivos_usuario_asociado ON public.archivos_asociados_usuario USING btree (usuario_id);


--
-- Name: idx_articulos_cod_articulo; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_articulos_cod_articulo ON public.articulos USING btree (codigo_articulo);


--
-- Name: idx_articulos_descripcion; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_articulos_descripcion ON public.articulos USING gin (to_tsvector('spanish'::regconfig, (descripcion)::text));


--
-- Name: idx_articulos_descripcion_trgm; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_articulos_descripcion_trgm ON public.articulos USING gin (descripcion public.gin_trgm_ops);


--
-- Name: idx_bitacora_objetivo; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_bitacora_objetivo ON public.objetivos_bitacora USING btree (objetivo_id);


--
-- Name: idx_carpeta_visibilidad_carpeta; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_carpeta_visibilidad_carpeta ON public.carpeta_visibilidad_usuario USING btree (id_carpeta) WHERE (deleted_at IS NULL);


--
-- Name: idx_carpeta_visibilidad_usuario; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_carpeta_visibilidad_usuario ON public.carpeta_visibilidad_usuario USING btree (id_usuario) WHERE (deleted_at IS NULL);


--
-- Name: idx_carpetas_padre; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_carpetas_padre ON public.carpetas USING btree (id_carpeta_padre) WHERE (deleted_at IS NULL);


--
-- Name: idx_carpetas_roles_gin; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_carpetas_roles_gin ON public.carpetas USING gin (allowed_roles);


--
-- Name: idx_carpetas_usuario; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_carpetas_usuario ON public.carpetas USING btree (id_usuario) WHERE (deleted_at IS NULL);


--
-- Name: idx_devices_is_active; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_devices_is_active ON public.devices USING btree (is_active);


--
-- Name: idx_devices_last_active; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_devices_last_active ON public.devices USING btree (last_active);


--
-- Name: idx_devices_push_token; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_devices_push_token ON public.devices USING btree (push_token);


--
-- Name: idx_devices_user_context_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_devices_user_context_id ON public.devices USING btree (user_context_id);


--
-- Name: idx_entidades_tipos_origen; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_entidades_tipos_origen ON public.entidades_tipos USING btree (origen);


--
-- Name: idx_idempotency_created_at; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_idempotency_created_at ON public.idempotency_records USING btree (created_at);


--
-- Name: idx_localidad_zona; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_localidad_zona ON public.localidades USING btree (zona);


--
-- Name: idx_notification_logs_device_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_notification_logs_device_id ON public.notification_logs USING btree (device_id);


--
-- Name: idx_notification_logs_expo_ticket_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_notification_logs_expo_ticket_id ON public.notification_logs USING btree (expo_ticket_id);


--
-- Name: idx_notification_logs_sent_at; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_notification_logs_sent_at ON public.notification_logs USING btree (sent_at);


--
-- Name: idx_notification_logs_status; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_notification_logs_status ON public.notification_logs USING btree (status);


--
-- Name: idx_notification_logs_user_context_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_notification_logs_user_context_id ON public.notification_logs USING btree (user_context_id);


--
-- Name: idx_objetivos_bitacora_solicitud; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_objetivos_bitacora_solicitud ON public.solicitudes_bitacora USING btree (solicitud_id);


--
-- Name: idx_objetivos_created_by; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_objetivos_created_by ON public.objetivos USING btree (created_by);


--
-- Name: idx_objetivos_rank; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_objetivos_rank ON public.objetivos USING btree (rank_position);


--
-- Name: idx_objetivos_tablero; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_objetivos_tablero ON public.objetivos USING btree (estado) WHERE (deleted_at IS NULL);


--
-- Name: idx_objetivos_usuarios_user_context_rol; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_objetivos_usuarios_user_context_rol ON public.objetivos_usuarios USING btree (user_context_id, rol);


--
-- Name: idx_opciones_pregunta_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_opciones_pregunta_id ON public.opciones USING btree (pregunta_id);


--
-- Name: idx_pedido_articulo_pedido; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_pedido_articulo_pedido ON public.pedido_articulo USING btree (nro_pedido);


--
-- Name: idx_pedidos_cliente_fecha; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_pedidos_cliente_fecha ON public.pedidos USING btree (id_cliente, fecha DESC);


--
-- Name: idx_planificacion_fecha_user; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_planificacion_fecha_user ON public.planificacion_diaria USING btree (fecha, user_context_id);


--
-- Name: idx_preguntas_encuesta_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_preguntas_encuesta_id ON public.preguntas USING btree (encuesta_id);


--
-- Name: idx_refresh_tokens_usuario; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_refresh_tokens_usuario ON public.refresh_tokens USING btree (id_usuario_entidad);


--
-- Name: idx_reporte_imagen_image_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_reporte_imagen_image_id ON public.reporte_imagen USING btree (image_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_reporte_imagen_reporte_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_reporte_imagen_reporte_id ON public.reporte_imagen USING btree (reporte_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_reportes_usuario_estado; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_reportes_usuario_estado ON public.reportes USING btree (usuario_reportado_id, estado);


--
-- Name: idx_respuestas_evaluado; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_respuestas_evaluado ON public.respuestas USING btree (evaluado_id, evaluado_tipo);


--
-- Name: idx_respuestas_fecha; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_respuestas_fecha ON public.respuestas USING btree (fecha_respuesta);


--
-- Name: idx_respuestas_pregunta_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_respuestas_pregunta_id ON public.respuestas USING btree (pregunta_id);


--
-- Name: idx_saldos_lookup; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_saldos_lookup ON public.saldos_ausencia USING btree (usuario_id, anio);


--
-- Name: idx_solicitudes_estado; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_solicitudes_estado ON public.solicitudes_ausencia USING btree (estado);


--
-- Name: idx_solicitudes_fechas; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_solicitudes_fechas ON public.solicitudes_ausencia USING btree (fecha_inicio);


--
-- Name: idx_solicitudes_invitados_deleted_at; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_solicitudes_invitados_deleted_at ON public.solicitudes_invitados USING btree (deleted_at);


--
-- Name: idx_solicitudes_usuario; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_solicitudes_usuario ON public.solicitudes_ausencia USING btree (usuario_id);


--
-- Name: idx_usuario_entidad_entidad; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_usuario_entidad_entidad ON public.usuario_entidad USING btree (id_entidad);


--
-- Name: idx_usuario_entidad_rol; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_usuario_entidad_rol ON public.usuario_entidad USING btree (id_rol);


--
-- Name: idx_usuario_entidad_usuario_tipo; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_usuario_entidad_usuario_tipo ON public.usuario_entidad USING btree (id_usuario, id_entidad_tipo);


--
-- Name: idx_usuarios_not_deleted; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_usuarios_not_deleted ON public.usuarios USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_usuarios_search_vector; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_usuarios_search_vector ON public.usuarios USING gin (to_tsvector('spanish'::regconfig, (((COALESCE(nombre, ''::character varying))::text || ' '::text) || (COALESCE(apellido, ''::character varying))::text)));


--
-- Name: idx_verif_tokens_contact; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_verif_tokens_contact ON public.verification_tokens USING btree (contact);


--
-- Name: idx_verif_tokens_expires_at; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_verif_tokens_expires_at ON public.verification_tokens USING btree (expires_at);


--
-- Name: idx_verif_tokens_user_id; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_verif_tokens_user_id ON public.verification_tokens USING btree (user_id);


--
-- Name: idx_visitas_cliente; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_visitas_cliente ON public.visitas USING btree (id_cliente);


--
-- Name: idx_visitas_fecha; Type: INDEX; Schema: public; Owner: mateo
--

CREATE INDEX idx_visitas_fecha ON public.visitas USING btree (fecha_visita);


--
-- Name: uq_archivos_compartidos_usuario; Type: INDEX; Schema: public; Owner: mateo
--

CREATE UNIQUE INDEX uq_archivos_compartidos_usuario ON public.archivos_visibilidad_usuario USING btree (archivo_id, usuario_id);


--
-- Name: actividades trg_actividad_deleted_at; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_actividad_deleted_at BEFORE DELETE ON public.actividades FOR EACH ROW EXECUTE FUNCTION public.fn_set_deleted_at();


--
-- Name: actividades trg_actividad_log; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_actividad_log AFTER INSERT OR DELETE OR UPDATE ON public.actividades FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: actividades trg_actividad_updated_at; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_actividad_updated_at BEFORE UPDATE ON public.actividades FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: actividades trg_actividades_delete_logico; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_actividades_delete_logico BEFORE DELETE ON public.actividades FOR EACH ROW EXECUTE FUNCTION public.fn_set_deleted_at();


--
-- Name: actividades trg_actividades_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_actividades_updated BEFORE UPDATE ON public.actividades FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: articulo_imagen trg_articulo_imagen_delete_logico; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_articulo_imagen_delete_logico BEFORE DELETE ON public.articulo_imagen FOR EACH ROW EXECUTE FUNCTION public.fn_set_deleted_at();

ALTER TABLE public.articulo_imagen DISABLE TRIGGER trg_articulo_imagen_delete_logico;


--
-- Name: articulo_imagen trg_articulo_imagen_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_articulo_imagen_logs AFTER INSERT OR DELETE OR UPDATE ON public.articulo_imagen FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: articulo_imagen trg_articulo_imagen_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_articulo_imagen_updated BEFORE UPDATE ON public.articulo_imagen FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: articulos trg_articulos_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_articulos_logs AFTER INSERT OR DELETE OR UPDATE ON public.articulos FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: clientes trg_clientes_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_clientes_logs AFTER INSERT OR DELETE OR UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: clientes trg_clientes_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_clientes_updated BEFORE UPDATE ON public.clientes FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: personal trg_empleados_delete_logico; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_empleados_delete_logico BEFORE DELETE ON public.personal FOR EACH ROW EXECUTE FUNCTION public.fn_set_deleted_at();


--
-- Name: personal trg_empleados_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_empleados_logs AFTER INSERT OR DELETE OR UPDATE ON public.personal FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: personal trg_empleados_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_empleados_updated BEFORE UPDATE ON public.personal FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: images trg_images_delete_logico; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_images_delete_logico BEFORE DELETE ON public.images FOR EACH ROW EXECUTE FUNCTION public.fn_set_deleted_at();


--
-- Name: images trg_images_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_images_logs AFTER INSERT OR DELETE OR UPDATE ON public.images FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: images trg_images_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_images_updated BEFORE UPDATE ON public.images FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: archivos trg_log_archivos; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_log_archivos AFTER INSERT OR DELETE OR UPDATE ON public.archivos FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: archivos_tipos trg_log_archivos_tipos; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_log_archivos_tipos AFTER INSERT OR DELETE OR UPDATE ON public.archivos_tipos FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: novedades trg_log_novedades; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_log_novedades AFTER INSERT OR DELETE OR UPDATE ON public.novedades FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: novedades_etiquetas trg_log_novedades_etiquetas; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_log_novedades_etiquetas AFTER INSERT OR DELETE OR UPDATE ON public.novedades_etiquetas FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: solicitudes trg_log_solicitudes; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_log_solicitudes AFTER INSERT OR DELETE OR UPDATE ON public.solicitudes FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: pedidos trg_pedidos_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_pedidos_logs AFTER INSERT OR DELETE OR UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: pedidos trg_pedidos_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_pedidos_updated BEFORE UPDATE ON public.pedidos FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: reportes trg_reportes_delete_logico; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_reportes_delete_logico BEFORE DELETE ON public.reportes FOR EACH ROW EXECUTE FUNCTION public.fn_set_deleted_at();


--
-- Name: reportes trg_reportes_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_reportes_logs AFTER INSERT OR DELETE OR UPDATE ON public.reportes FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: reportes trg_reportes_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_reportes_updated BEFORE UPDATE ON public.reportes FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: saldos_ausencia trg_saldos_ausencia_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_saldos_ausencia_updated BEFORE UPDATE ON public.saldos_ausencia FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: suscripciones trg_suscripciones_delete_logico; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_suscripciones_delete_logico BEFORE DELETE ON public.suscripciones FOR EACH ROW EXECUTE FUNCTION public.fn_set_deleted_at();


--
-- Name: suscripciones trg_suscripciones_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_suscripciones_logs AFTER INSERT OR DELETE OR UPDATE ON public.suscripciones FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: suscripciones trg_suscripciones_updated; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_suscripciones_updated BEFORE UPDATE ON public.suscripciones FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();


--
-- Name: usuarios trg_usuario_deleted_at; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_usuario_deleted_at BEFORE DELETE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.fn_set_deleted_at();

ALTER TABLE public.usuarios DISABLE TRIGGER trg_usuario_deleted_at;


--
-- Name: usuarios trg_usuario_log; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_usuario_log AFTER INSERT OR DELETE OR UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();

ALTER TABLE public.usuarios DISABLE TRIGGER trg_usuario_log;


--
-- Name: usuarios trg_usuario_updated_at; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_usuario_updated_at BEFORE UPDATE ON public.usuarios FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

ALTER TABLE public.usuarios DISABLE TRIGGER trg_usuario_updated_at;


--
-- Name: verification_tokens trg_verification_tokens_logs; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trg_verification_tokens_logs AFTER INSERT OR DELETE OR UPDATE ON public.verification_tokens FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: reportes trigger_log_reportes; Type: TRIGGER; Schema: public; Owner: mateo
--

CREATE TRIGGER trigger_log_reportes AFTER INSERT OR DELETE OR UPDATE ON public.reportes FOR EACH ROW EXECUTE FUNCTION public.fn_log_operacion();


--
-- Name: actividades_participantes actividades_participantes_id_actividad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.actividades_participantes
    ADD CONSTRAINT actividades_participantes_id_actividad_fkey FOREIGN KEY (id_actividad) REFERENCES public.actividades(id) ON DELETE CASCADE;


--
-- Name: actividades_participantes actividades_participantes_id_usuario_participante_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.actividades_participantes
    ADD CONSTRAINT actividades_participantes_id_usuario_participante_fkey FOREIGN KEY (id_usuario_participante) REFERENCES public.usuario_entidad(id) ON DELETE CASCADE;


--
-- Name: actividades actividades_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.actividades
    ADD CONSTRAINT actividades_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes(solicitud_id) ON DELETE SET NULL;


--
-- Name: archivos_asociados_usuario archivos_asociados_usuario_archivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_asociados_usuario
    ADD CONSTRAINT archivos_asociados_usuario_archivo_id_fkey FOREIGN KEY (archivo_id) REFERENCES public.archivos(id) ON DELETE CASCADE;


--
-- Name: archivos_asociados_usuario archivos_asociados_usuario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_asociados_usuario
    ADD CONSTRAINT archivos_asociados_usuario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id) ON DELETE CASCADE;


--
-- Name: archivos archivos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos
    ADD CONSTRAINT archivos_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.usuario_entidad(id);


--
-- Name: archivos archivos_id_tipo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos
    ADD CONSTRAINT archivos_id_tipo_fkey FOREIGN KEY (id_tipo) REFERENCES public.archivos_tipos(id);


--
-- Name: archivos_visibilidad_usuario archivos_visibilidad_usuario_archivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_visibilidad_usuario
    ADD CONSTRAINT archivos_visibilidad_usuario_archivo_id_fkey FOREIGN KEY (archivo_id) REFERENCES public.archivos(id) ON DELETE CASCADE;


--
-- Name: archivos_visibilidad_usuario archivos_visibilidad_usuario_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_visibilidad_usuario
    ADD CONSTRAINT archivos_visibilidad_usuario_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id) ON DELETE CASCADE;


--
-- Name: articulo_imagen articulo_imagen_articulo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.articulo_imagen
    ADD CONSTRAINT articulo_imagen_articulo_id_fkey FOREIGN KEY (articulo_id) REFERENCES public.articulos(codigo_articulo) ON DELETE CASCADE;


--
-- Name: articulo_imagen articulo_imagen_image_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.articulo_imagen
    ADD CONSTRAINT articulo_imagen_image_id_fkey FOREIGN KEY (image_id) REFERENCES public.images(id) ON DELETE CASCADE;


--
-- Name: clientes clientes_id_condicion_iva_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_id_condicion_iva_fkey FOREIGN KEY (id_condicion_iva) REFERENCES public.condiciones_iva(id_condicion);


--
-- Name: clientes clientes_id_localidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.clientes
    ADD CONSTRAINT clientes_id_localidad_fkey FOREIGN KEY (id_localidad) REFERENCES public.localidades(id_localidad);


--
-- Name: devices devices_user_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_user_context_id_fkey FOREIGN KEY (user_context_id) REFERENCES public.usuario_entidad(id) ON DELETE CASCADE;


--
-- Name: archivos_actividades fk_archivo_actividad; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_actividades
    ADD CONSTRAINT fk_archivo_actividad FOREIGN KEY (actividad_id) REFERENCES public.actividades(id) ON DELETE CASCADE;


--
-- Name: archivo_aperturas fk_archivo_aperturas_archivo; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivo_aperturas
    ADD CONSTRAINT fk_archivo_aperturas_archivo FOREIGN KEY (archivo_id) REFERENCES public.archivos(id) ON DELETE CASCADE;


--
-- Name: archivo_aperturas fk_archivo_aperturas_usuario; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivo_aperturas
    ADD CONSTRAINT fk_archivo_aperturas_usuario FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id) ON DELETE CASCADE;


--
-- Name: archivos_objetivos fk_archivo_objetivo; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_objetivos
    ADD CONSTRAINT fk_archivo_objetivo FOREIGN KEY (objetivo_id) REFERENCES public.objetivos(id) ON DELETE CASCADE;


--
-- Name: archivos_solicitudes fk_archivo_solicitud; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos_solicitudes
    ADD CONSTRAINT fk_archivo_solicitud FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes(solicitud_id) ON DELETE CASCADE;


--
-- Name: archivos fk_archivos_carpeta; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.archivos
    ADD CONSTRAINT fk_archivos_carpeta FOREIGN KEY (id_carpeta) REFERENCES public.carpetas(id) ON DELETE SET NULL;


--
-- Name: solicitudes_bitacora_archivo fk_bitacora_archivo_archivo; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_bitacora_archivo
    ADD CONSTRAINT fk_bitacora_archivo_archivo FOREIGN KEY (archivo_id) REFERENCES public.archivos(id) ON DELETE CASCADE;


--
-- Name: solicitudes_bitacora_archivo fk_bitacora_archivo_bitacora; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_bitacora_archivo
    ADD CONSTRAINT fk_bitacora_archivo_bitacora FOREIGN KEY (bitacora_id) REFERENCES public.solicitudes_bitacora(id) ON DELETE CASCADE;


--
-- Name: carpeta_visibilidad_usuario fk_carpeta_visibilidad_carpeta; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpeta_visibilidad_usuario
    ADD CONSTRAINT fk_carpeta_visibilidad_carpeta FOREIGN KEY (id_carpeta) REFERENCES public.carpetas(id) ON DELETE CASCADE;


--
-- Name: carpeta_visibilidad_usuario fk_carpeta_visibilidad_usuario_entidad; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpeta_visibilidad_usuario
    ADD CONSTRAINT fk_carpeta_visibilidad_usuario_entidad FOREIGN KEY (id_usuario) REFERENCES public.usuario_entidad(id);


--
-- Name: carpetas fk_carpetas_padre; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpetas
    ADD CONSTRAINT fk_carpetas_padre FOREIGN KEY (id_carpeta_padre) REFERENCES public.carpetas(id) ON DELETE CASCADE;


--
-- Name: carpetas fk_carpetas_usuario_entidad; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.carpetas
    ADD CONSTRAINT fk_carpetas_usuario_entidad FOREIGN KEY (id_usuario) REFERENCES public.usuario_entidad(id);


--
-- Name: objetivos fk_objetivos_solicitud; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos
    ADD CONSTRAINT fk_objetivos_solicitud FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes(solicitud_id) ON DELETE SET NULL;


--
-- Name: objetivos_usuarios fk_ou_objetivo; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_usuarios
    ADD CONSTRAINT fk_ou_objetivo FOREIGN KEY (objetivo_id) REFERENCES public.objetivos(id) ON DELETE CASCADE;


--
-- Name: objetivos_usuarios fk_ou_usuario; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_usuarios
    ADD CONSTRAINT fk_ou_usuario FOREIGN KEY (user_context_id) REFERENCES public.usuario_entidad(id) ON DELETE CASCADE;


--
-- Name: planificacion_diaria fk_planificacion_solicitud_usuario; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.planificacion_diaria
    ADD CONSTRAINT fk_planificacion_solicitud_usuario FOREIGN KEY (user_context_id) REFERENCES public.usuario_entidad(id);


--
-- Name: visitas fk_visita_cliente; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.visitas
    ADD CONSTRAINT fk_visita_cliente FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente) ON DELETE CASCADE;


--
-- Name: notification_logs notification_logs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id) ON DELETE CASCADE;


--
-- Name: notification_logs notification_logs_user_context_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.notification_logs
    ADD CONSTRAINT notification_logs_user_context_id_fkey FOREIGN KEY (user_context_id) REFERENCES public.usuario_entidad(id) ON DELETE CASCADE;


--
-- Name: novedades novedades_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.novedades
    ADD CONSTRAINT novedades_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.usuario_entidad(id);


--
-- Name: novedades novedades_id_etiqueta_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.novedades
    ADD CONSTRAINT novedades_id_etiqueta_fkey FOREIGN KEY (id_etiqueta) REFERENCES public.novedades_etiquetas(id);


--
-- Name: objetivos_bitacora objetivos_bitacora_objetivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_bitacora
    ADD CONSTRAINT objetivos_bitacora_objetivo_id_fkey FOREIGN KEY (objetivo_id) REFERENCES public.objetivos(id) ON DELETE CASCADE;


--
-- Name: objetivos_bitacora objetivos_bitacora_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos_bitacora
    ADD CONSTRAINT objetivos_bitacora_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id);


--
-- Name: objetivos objetivos_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos
    ADD CONSTRAINT objetivos_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.usuario_entidad(id);


--
-- Name: objetivos objetivos_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.objetivos
    ADD CONSTRAINT objetivos_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.usuario_entidad(id);


--
-- Name: opciones opciones_pregunta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.opciones
    ADD CONSTRAINT opciones_pregunta_id_fkey FOREIGN KEY (pregunta_id) REFERENCES public.preguntas(id) ON DELETE CASCADE;


--
-- Name: pagos pagos_nro_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pagos
    ADD CONSTRAINT pagos_nro_pedido_fkey FOREIGN KEY (nro_pedido) REFERENCES public.pedidos(nro_pedido);


--
-- Name: pedido_articulo pedido_articulo_codigo_articulo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedido_articulo
    ADD CONSTRAINT pedido_articulo_codigo_articulo_fkey FOREIGN KEY (codigo_articulo) REFERENCES public.articulos(codigo_articulo) ON DELETE RESTRICT;


--
-- Name: pedido_articulo pedido_articulo_codigo_articulo_reemplazo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedido_articulo
    ADD CONSTRAINT pedido_articulo_codigo_articulo_reemplazo_fkey FOREIGN KEY (codigo_articulo_reemplazo) REFERENCES public.articulos(codigo_articulo);


--
-- Name: pedido_articulo pedido_articulo_nro_pedido_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedido_articulo
    ADD CONSTRAINT pedido_articulo_nro_pedido_fkey FOREIGN KEY (nro_pedido) REFERENCES public.pedidos(nro_pedido) ON DELETE CASCADE;


--
-- Name: pedidos pedidos_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente) ON DELETE RESTRICT;


--
-- Name: pedidos pedidos_id_condicion_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.pedidos
    ADD CONSTRAINT pedidos_id_condicion_fkey FOREIGN KEY (id_condicion) REFERENCES public.condiciones_venta(id_condicion);


--
-- Name: preguntas preguntas_encuesta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.preguntas
    ADD CONSTRAINT preguntas_encuesta_id_fkey FOREIGN KEY (encuesta_id) REFERENCES public.encuestas(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_id_usuario_entidad_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_id_usuario_entidad_fkey FOREIGN KEY (id_usuario_entidad) REFERENCES public.usuario_entidad(id);


--
-- Name: reporte_actividad reporte_actividad_reporte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_actividad
    ADD CONSTRAINT reporte_actividad_reporte_id_fkey FOREIGN KEY (reporte_id) REFERENCES public.reportes(id) ON DELETE CASCADE;


--
-- Name: reporte_actividad reporte_actividad_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_actividad
    ADD CONSTRAINT reporte_actividad_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id);


--
-- Name: reporte_imagen reporte_imagen_image_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_imagen
    ADD CONSTRAINT reporte_imagen_image_id_fkey FOREIGN KEY (image_id) REFERENCES public.images(id) ON DELETE CASCADE;


--
-- Name: reporte_imagen reporte_imagen_reporte_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reporte_imagen
    ADD CONSTRAINT reporte_imagen_reporte_id_fkey FOREIGN KEY (reporte_id) REFERENCES public.reportes(id) ON DELETE CASCADE;


--
-- Name: reportes reportes_creador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reportes
    ADD CONSTRAINT reportes_creador_id_fkey FOREIGN KEY (creador_id) REFERENCES public.usuario_entidad(id);


--
-- Name: reportes reportes_usuario_reportado_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.reportes
    ADD CONSTRAINT reportes_usuario_reportado_id_fkey FOREIGN KEY (usuario_reportado_id) REFERENCES public.usuario_entidad(id);


--
-- Name: respuestas respuestas_opcion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.respuestas
    ADD CONSTRAINT respuestas_opcion_id_fkey FOREIGN KEY (opcion_id) REFERENCES public.opciones(id);


--
-- Name: respuestas respuestas_pregunta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.respuestas
    ADD CONSTRAINT respuestas_pregunta_id_fkey FOREIGN KEY (pregunta_id) REFERENCES public.preguntas(id);


--
-- Name: respuestas respuestas_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.respuestas
    ADD CONSTRAINT respuestas_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id);


--
-- Name: saldos_ausencia saldos_ausencia_tipo_licencia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.saldos_ausencia
    ADD CONSTRAINT saldos_ausencia_tipo_licencia_id_fkey FOREIGN KEY (tipo_licencia_id) REFERENCES public.tipos_licencia(id);


--
-- Name: saldos_ausencia saldos_ausencia_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.saldos_ausencia
    ADD CONSTRAINT saldos_ausencia_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id);


--
-- Name: solicitudes_archivos solicitudes_archivos_archivo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_archivos
    ADD CONSTRAINT solicitudes_archivos_archivo_id_fkey FOREIGN KEY (archivo_id) REFERENCES public.archivos(id) ON DELETE CASCADE;


--
-- Name: solicitudes_archivos solicitudes_archivos_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_archivos
    ADD CONSTRAINT solicitudes_archivos_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes_ausencia(id) ON DELETE CASCADE;


--
-- Name: solicitudes_ausencia solicitudes_ausencia_aprobador_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_ausencia
    ADD CONSTRAINT solicitudes_ausencia_aprobador_id_fkey FOREIGN KEY (aprobador_id) REFERENCES public.usuario_entidad(id);


--
-- Name: solicitudes_ausencia solicitudes_ausencia_tipo_licencia_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_ausencia
    ADD CONSTRAINT solicitudes_ausencia_tipo_licencia_id_fkey FOREIGN KEY (tipo_licencia_id) REFERENCES public.tipos_licencia(id);


--
-- Name: solicitudes_ausencia solicitudes_ausencia_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_ausencia
    ADD CONSTRAINT solicitudes_ausencia_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id);


--
-- Name: solicitudes_bitacora solicitudes_bitacora_solicitud_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_bitacora
    ADD CONSTRAINT solicitudes_bitacora_solicitud_id_fkey FOREIGN KEY (solicitud_id) REFERENCES public.solicitudes(solicitud_id) ON DELETE CASCADE;


--
-- Name: solicitudes_bitacora solicitudes_bitacora_usuario_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_bitacora
    ADD CONSTRAINT solicitudes_bitacora_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES public.usuario_entidad(id);


--
-- Name: solicitudes solicitudes_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes
    ADD CONSTRAINT solicitudes_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.usuario_entidad(id);


--
-- Name: solicitudes_invitados solicitudes_invitados_id_solicitud_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_invitados
    ADD CONSTRAINT solicitudes_invitados_id_solicitud_fkey FOREIGN KEY (id_solicitud) REFERENCES public.solicitudes(solicitud_id) ON DELETE CASCADE;


--
-- Name: solicitudes_invitados solicitudes_invitados_id_usuario_invitado_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.solicitudes_invitados
    ADD CONSTRAINT solicitudes_invitados_id_usuario_invitado_fkey FOREIGN KEY (id_usuario_invitado) REFERENCES public.usuario_entidad(id) ON DELETE CASCADE;


--
-- Name: telefonos telefonos_id_cliente_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.telefonos
    ADD CONSTRAINT telefonos_id_cliente_fkey FOREIGN KEY (id_cliente) REFERENCES public.clientes(id_cliente) ON DELETE CASCADE;


--
-- Name: telefonos telefonos_id_personal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.telefonos
    ADD CONSTRAINT telefonos_id_personal_fkey FOREIGN KEY (id_personal) REFERENCES public.personal(id_empleado);


--
-- Name: usuario_entidad usuario_entidad_id_entidad_tipo_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuario_entidad
    ADD CONSTRAINT usuario_entidad_id_entidad_tipo_fkey FOREIGN KEY (id_entidad_tipo) REFERENCES public.entidades_tipos(id);


--
-- Name: usuario_entidad usuario_entidad_id_rol_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuario_entidad
    ADD CONSTRAINT usuario_entidad_id_rol_fkey FOREIGN KEY (id_rol) REFERENCES public.roles(id_rol);


--
-- Name: usuario_entidad usuario_entidad_id_usuario_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.usuario_entidad
    ADD CONSTRAINT usuario_entidad_id_usuario_fkey FOREIGN KEY (id_usuario) REFERENCES public.usuarios(id);


--
-- Name: verification_tokens verification_tokens_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.usuario_entidad(id);


--
-- Name: verification_tokens verification_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: mateo
--

ALTER TABLE ONLY public.verification_tokens
    ADD CONSTRAINT verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.usuarios(id);


--
-- Name: FUNCTION gtrgm_in(cstring); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_out(public.gtrgm); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION fn_log_operacion(); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION fn_set_deleted_at(); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION fn_set_updated_at(); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gin_extract_value_trgm(text, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_compress(internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_consistent(internal, text, smallint, oid, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_decompress(internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_distance(internal, text, smallint, oid, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_options(internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_penalty(internal, internal, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_picksplit(internal, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_same(public.gtrgm, public.gtrgm, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION gtrgm_union(internal, internal); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION set_limit(real); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION show_limit(); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION show_trgm(text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION similarity(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION similarity_dist(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION similarity_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION strict_word_similarity(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION strict_word_similarity_commutator_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION strict_word_similarity_dist_commutator_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION strict_word_similarity_dist_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION strict_word_similarity_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION word_similarity(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION word_similarity_commutator_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION word_similarity_dist_commutator_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION word_similarity_dist_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: FUNCTION word_similarity_op(text, text); Type: ACL; Schema: public; Owner: postgres
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--



--
-- PostgreSQL database dump complete
--

\unrestrict 5ESWGfPmeoWPnCt6A3vKsAtAKPwvBdXeQ3PW1ZMgeYMr2qMcXg2Zg0PB9t02M5Q

