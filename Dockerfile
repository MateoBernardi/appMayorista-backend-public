# ==========================================
# Etapa 1: Construcción (Builder)
# ==========================================
FROM node:22.23.4-alpine AS builder

WORKDIR /app

# Usar npm ci es más rápido y determinista en CI/CD que npm install
COPY package*.json ./
RUN npm ci

# Copiar el código y compilar TypeScript
COPY . .
RUN npm run build

# ==========================================
# Etapa 2: Producción (Runner)
# ==========================================
FROM node:22.23.4-alpine AS runner

WORKDIR /app

# Forzar el entorno a producción
ENV NODE_ENV=production
ENV PORT=3000

# Copiar solo los manifiestos de dependencias
COPY package*.json ./

# Instalar ÚNICAMENTE dependencias de producción (ignora devDependencies)
RUN npm ci --omit=dev && apk add --no-cache postgresql-client

# Traer solo la carpeta 'dist' ya compilada desde la etapa anterior
COPY --from=builder /app/dist ./dist

COPY --from=builder /app/database ./database

COPY --from=builder /app/migrations ./migrations

# Seguridad: Cambiar al usuario 'node' sin privilegios de root
USER node

# Exponer el puerto
EXPOSE 3000

# Comando de inicio
CMD ["node", "dist/index.js"]   