declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: number
        userContextId: number
        role: string
        entorno: string
        entidadTipoId?: number
        entidadId?: number
        requiresAssociation?: boolean
      }
    }
  }
}

export {}
