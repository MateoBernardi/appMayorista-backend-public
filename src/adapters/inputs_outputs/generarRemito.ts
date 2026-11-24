import PDFDocument from 'pdfkit';

export interface ClienteInfo {
  nombre: string;
  direccion: string;
  localidad: string;
  cuit_dni: string;
  email: string;
  zona?: string;
}

export interface RemitoInfo {
  numero: string;
  fecha: string;
}

export interface ItemDetalle {
  codigo_articulo?: string;
  articulo?: string;
  cantidad: number | string;
  precio_unitario?: number | string;
  monto_total?: number | string;
}

// Estructura unificada para el arreglo de entrada
export interface PedidoInput {
  cliente: ClienteInfo;
  remito: RemitoInfo;
  detalle: ItemDetalle[];
}

export function formatearFechaRemito(fecha?: Date | string): string {
  if (!fecha) return new Date().toLocaleDateString();
  const parsed = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(parsed.getTime())) return String(fecha);
  return parsed.toLocaleDateString();
}

/**
 * Función única para generar PDFs de ventas.
 * Soporta un único pedido o múltiples pedidos con hoja de ruta/depósito automática.
 */
export function generarComprobantesPDF(pedidos: PedidoInput[]): PDFKit.PDFDocument {
  if (!pedidos || pedidos.length === 0) {
    throw new Error("Debe proveer al menos un pedido para generar el PDF.");
  }

  // 1. Inicializamos el documento maestro
  const doc = new PDFDocument({ margin: 40, size: 'A4' });

  const azulPrincipal = '#1a237e';
  const azulSecundario = '#274690';
  const grisSeparador = '#e0e0e0';

  // Objeto para acumular el stock total para el depósito, agrupado por zona
  // (en caso de que sean múltiples pedidos)
  const resumenDeposito: { [zona: string]: { [codigo: string]: { descripcion: string; cantidad: number } } } = {};

  // Objeto para acumular el total facturado por zona (en caso de que sean múltiples pedidos)
  const totalPorZona: { [zona: string]: number } = {};

  // 2. Iteramos sobre el arreglo de pedidos de forma automática
  pedidos.forEach((pedido, index) => {
    // Si no es el primer pedido, creamos una nueva hoja para el siguiente remito
    if (index > 0) {
      doc.addPage();
    }

    const { cliente, remito, detalle } = pedido;

    // --- DIBUJAR LOS DATOS DEL CLIENTE ---
    doc
      .fontSize(12)
      .fillColor('black')
      .font('Helvetica')
      .text(
        `Cliente: ${cliente.nombre}\nDirección: ${cliente.direccion}\nLocalidad: ${cliente.localidad}\nCUIT/DNI: ${cliente.cuit_dni}`,
        40,
        doc.y,
        { align: 'left', continued: false }
      );

    // --- DIBUJAR DATOS DEL REMITO (DERECHA) ---
    const rightColumnX = doc.page.width - doc.page.margins.right - 200; 
    const clienteDatosY = doc.y - doc.currentLineHeight(); 

    doc
      .fontSize(12)
      .fillColor('black')
      .font('Helvetica')
      .text(
        `Fecha: ${remito.fecha}\nN° Pedido: ${remito.numero}`,
        rightColumnX,
        clienteDatosY,
        { align: 'right' }
      );

    // --- ETIQUETA DE ZONA (para agrupar/identificar remitos al pasar hojas) ---
    if (pedidos.length > 1 && cliente.zona) {
      doc
        .fontSize(10)
        .fillColor(azulSecundario)
        .font('Helvetica-Bold')
        .text(`Zona: ${cliente.zona}`, 40, doc.y + 4);
    }

    doc.moveDown(1);

    // --- TABLA DE ARTÍCULOS ---
    const tableTop = doc.y + 10;
    const col = { codigo: 40, descripcion: 110, cantidad: 340, precio: 460 };

    // Encabezado de la tabla
    doc
      .fontSize(12)
      .fillColor(azulPrincipal)
      .font('Helvetica-Bold')
      .text('Código', col.codigo, tableTop)
      .text('Descripción', col.descripcion, tableTop)
      .text('Cantidad', col.cantidad, tableTop)
      .text('Precio', col.precio, tableTop);

    doc
      .moveTo(col.codigo, tableTop + 18)
      .lineTo(540, tableTop + 18)
      .lineWidth(1)
      .strokeColor(grisSeparador)
      .stroke();

    let y = tableTop + 24;
    const rowHeight = 18;
    const firmaFooterY = 700;
    const totalOffset = 10;
    const totalLineHeight = 14;
    const maxY = firmaFooterY - totalOffset - totalLineHeight;

    // Función interna para redibujar encabezados si el remito actual ocupa más de una hoja
    const drawTableHeader = (yHeader: number) => {
      doc
        .fontSize(12)
        .fillColor(azulPrincipal)
        .font('Helvetica-Bold')
        .text('Código', col.codigo, yHeader)
        .text('Descripción', col.descripcion, yHeader)
        .text('Cantidad', col.cantidad, yHeader)
        .text('Precio', col.precio, yHeader);
      doc
        .moveTo(col.codigo, yHeader + 18)
        .lineTo(540, yHeader + 18)
        .lineWidth(1)
        .strokeColor(grisSeparador)
        .stroke();
      return yHeader + 24;
    };

    // Dibujar las filas del remito actual
    detalle.forEach((item) => {
      if (y + rowHeight > maxY) {
        doc.addPage();
        y = doc.page.margins.top + 40; 
        y = drawTableHeader(y - 24); 
      }
      
      doc
        .font('Helvetica').fontSize(11).fillColor('black')
        .text(item.codigo_articulo || '', col.codigo, y)
        .fontSize(9)
        .text(item.articulo || '', col.descripcion, y, { width: 210 })
        .fontSize(9)
        .text(item.cantidad.toString(), col.cantidad, y, { width: 50, align: 'right' })
        .text(item.precio_unitario != null ? `$${item.precio_unitario}` : '', col.precio, y, { width: 60, align: 'right' });
      
      doc
        .moveTo(col.codigo, y + rowHeight - 2)
        .lineTo(540, y + rowHeight - 2)
        .lineWidth(0.5)
        .strokeColor(grisSeparador)
        .stroke();
      
      y += rowHeight;

      // ARREGLO AUTOMÁTICO PARA EL DEPÓSITO: Acumulamos sólo si hay más de 1 pedido en total,
      // agrupado por zona para que el armado de camión también quede dividido por zona.
      if (pedidos.length > 1) {
        const zonaCodigo = cliente.zona || 'Sin zona';
        const codigo = item.codigo_articulo || 'SIN_CODIGO';
        if (!resumenDeposito[zonaCodigo]) {
          resumenDeposito[zonaCodigo] = {};
        }
        if (!resumenDeposito[zonaCodigo][codigo]) {
          resumenDeposito[zonaCodigo][codigo] = {
            descripcion: item.articulo || '',
            cantidad: 0
          };
        }
        resumenDeposito[zonaCodigo][codigo].cantidad += Number(item.cantidad || 0);
      }
    });

    // Total del Pedido Actual
    let totalPedido = detalle.reduce((acc, item) => acc + Number(item.monto_total || 0), 0);

    if (pedidos.length > 1) {
      const zona = cliente.zona || 'Sin zona';
      totalPorZona[zona] = (totalPorZona[zona] || 0) + totalPedido;
    }

    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(azulPrincipal)
      .text(`TOTAL: $${totalPedido.toFixed(2)}`, col.precio, y + totalOffset, { align: 'right' });

    // Pie de página del Remito
    doc
      .font('Helvetica')
      .fontSize(11)
      .fillColor('black')
      .text('Firma/Recibido: ___________________________', 40, firmaFooterY);

    doc
      .fontSize(9)
      .fillColor(azulSecundario)
      .text(
        'Nota: La mercadería consignada en este remito fue entregada en perfectas condiciones. Consulte condiciones en www.italoarg.com.ar',
        40,
        730,
        { width: 500, align: 'center' }
      );
  });

  // 3. HOJA(S) DE DEPÓSITO PARA ARMADO DE CAMIÓN, DIVIDIDAS POR ZONA (Solo si el arreglo tiene más de 1 pedido)
  if (pedidos.length > 1) {
    doc.addPage();

    doc
      .fontSize(18)
      .fillColor(azulPrincipal)
      .font('Helvetica-Bold')
      .text('RESUMEN DE CARGA CONSOLIDADA (Para armado de camión / Depósito)', { align: 'center' });

    doc.moveDown(2);

    const colDep = { codigo: 40, descripcion: 130, cantidad: 450 };
    const depositoMaxY = 750;

    // Dibuja el encabezado de la tabla de depósito y devuelve la próxima Y disponible
    const drawDepTableHeader = (yHeader: number) => {
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor('black')
        .text('Código Art.', colDep.codigo, yHeader)
        .text('Descripción', colDep.descripcion, yHeader)
        .text('Cant. Total', colDep.cantidad, yHeader, { align: 'right', width: 80 });
      doc
        .moveTo(colDep.codigo, yHeader + 15)
        .lineTo(540, yHeader + 15)
        .lineWidth(1)
        .strokeColor(grisSeparador)
        .stroke();
      return yHeader + 22;
    };

    let currentY = doc.y;
    const zonasDeposito = Object.keys(resumenDeposito).sort();

    // Una sección (encabezado + tabla) por zona, para que el armado del camión también quede dividido
    zonasDeposito.forEach((zona, zonaIdx) => {
      if (currentY > depositoMaxY - 50) {
        doc.addPage();
        currentY = 50;
      } else if (zonaIdx > 0) {
        currentY += 14;
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(azulSecundario)
        .text(`Zona: ${zona}`, colDep.codigo, currentY);
      currentY += 20;

      currentY = drawDepTableHeader(currentY);

      const items = resumenDeposito[zona] ?? {};
      for (const codigo in items) {
        const item = items[codigo];
        if (!item) continue;

        // Control de salto de página dentro de la sección de zona si hay demasiados artículos únicos
        if (currentY > depositoMaxY) {
          doc.addPage();
          currentY = 50;
          currentY = drawDepTableHeader(currentY);
        }

        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor('black')
          .text(codigo, colDep.codigo, currentY)
          .text(item.descripcion, colDep.descripcion, currentY, { width: 300 })
          .font('Helvetica-Bold') // Negrita en la cantidad para evitar confusiones al armar
          .text(item.cantidad.toString(), colDep.cantidad, currentY, { align: 'right', width: 80 })
          .font('Helvetica');

        doc
          .moveTo(colDep.codigo, currentY + 14)
          .lineTo(540, currentY + 14)
          .lineWidth(0.5)
          .strokeColor(grisSeparador)
          .stroke();

        currentY += 18;
      }
    });
  }

  // 4. HOJA FINAL DE RESUMEN DE FACTURACIÓN POR ZONA (solo si hay más de 1 pedido)
  if (pedidos.length > 1) {
    doc.addPage();

    doc
      .fontSize(18)
      .fillColor(azulPrincipal)
      .font('Helvetica-Bold')
      .text('RESUMEN DE FACTURACIÓN POR ZONA', { align: 'center' });

    doc.moveDown(2);

    const tableTopZona = doc.y;
    const colZona = { zona: 40, total: 400 };

    doc
      .fontSize(12)
      .font('Helvetica-Bold')
      .fillColor('black')
      .text('Zona', colZona.zona, tableTopZona)
      .text('Total', colZona.total, tableTopZona, { align: 'right', width: 100 });

    doc
      .moveTo(colZona.zona, tableTopZona + 18)
      .lineTo(540, tableTopZona + 18)
      .lineWidth(1)
      .strokeColor(grisSeparador)
      .stroke();

    let zonaY = tableTopZona + 26;
    let totalGeneral = 0;

    const zonasOrdenadas = Object.keys(totalPorZona).sort();
    for (const zona of zonasOrdenadas) {
      const totalZona = totalPorZona[zona] ?? 0;
      totalGeneral += totalZona;

      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor('black')
        .text(zona, colZona.zona, zonaY)
        .text(`$${totalZona.toFixed(2)}`, colZona.total, zonaY, { align: 'right', width: 100 });

      zonaY += 20;
    }

    doc
      .moveTo(colZona.zona, zonaY + 4)
      .lineTo(540, zonaY + 4)
      .lineWidth(1)
      .strokeColor(grisSeparador)
      .stroke();

    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(azulPrincipal)
      .text('TOTAL GENERAL', colZona.zona, zonaY + 16)
      .text(`$${totalGeneral.toFixed(2)}`, colZona.total, zonaY + 16, { align: 'right', width: 100 });
  }

  // 5. Finalizamos el documento de manera interna
  doc.end();

  // Retornamos el stream listo para ser escuchado o enviado por HTTP pipe (.pipe(res))
  return doc;
}