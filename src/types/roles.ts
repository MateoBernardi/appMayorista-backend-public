// Arreglos de roles para uso en rutas y validaciones
export const managementRoles = ['gerencia', 'personasRelaciones', 'presidencia', 'encargado', 'consejo'];
export const adminRoles = ['gerencia', 'personasRelaciones', 'presidencia', 'contable', 'sistemas', 'consejo'];
export const allRoles = ['ventas', 'deposito', 'admin', 'contable', 'gerencia', 'personasRelaciones', 'consejo', 'encargado', 'empleado-limpieza', 'presidencia', 'sistemas', 'empleado-admin', 'empleado-insumos', 'empleado-mayorista', 'empleado-super', 'empleado-transporte', 'estudio-contable', 'kiosco', 'admin-products', 'admin-content'];
export const supervisorRoles = ['gerencia', 'personasRelaciones', 'encargado'];
export const kioskRoles = ['kiosco'];
// Únicos roles habilitados para aprobar/rechazar licencias, en cualquier estado
// (EXPIRADA incluida) y aunque falte documentación requerida.
export const licenciaAprobadorRoles = ['gerencia', 'encargado', 'presidencia'];

// Roles del panel /admin del sitio web (e-commerce), distintos de adminRoles (HR interno).
export const productAdminRoles = ['admin-products'];
export const contentAdminRoles = ['admin-content'];
export const anyAdminRoles = ['admin-products', 'admin-content'];