import { extraerMenciones, sanitizeInformeHtml, textoPlano } from '../../utils/sanitizeHtml';

describe('sanitizeInformeHtml', () => {
  it('elimina scripts con su contenido y comentarios', () => {
    expect(sanitizeInformeHtml('<p>hola</p><script>alert(1)</script><!-- x -->')).toBe('<p>hola</p>');
  });

  it('quita handlers, estilos y clases', () => {
    const html = sanitizeInformeHtml('<p onclick="x()" style="color:red" class="a">hola</p>');
    expect(html).toBe('<p>hola</p>');
  });

  it('desenvuelve etiquetas no permitidas y descarta img', () => {
    expect(sanitizeInformeHtml('<div><img src="x" onerror="x()">texto</div>')).toBe('texto');
  });

  it('solo deja href http(s)', () => {
    expect(sanitizeInformeHtml('<a href="javascript:alert(1)">x</a>')).toBe('x');
    expect(sanitizeInformeHtml('<a href="https://a.com" onclick="y()">x</a>')).toBe(
      '<a href="https://a.com">x</a>',
    );
  });

  it('conserva data-mention numérico y descarta el inválido', () => {
    expect(sanitizeInformeHtml('<span data-mention="12" class="c">Ana</span>')).toBe(
      '<span data-mention="12">Ana</span>',
    );
    expect(sanitizeInformeHtml('<span data-mention="1 onclick=x">Ana</span>')).toBe('Ana');
    expect(sanitizeInformeHtml('<span data-mention="abc">Ana</span>')).toBe('Ana');
  });
});

describe('adjuntos en línea', () => {
  it('conserva div[data-adjunto] numérico y aplana el resto', () => {
    expect(sanitizeInformeHtml('<p>a</p><div data-adjunto="2" class="x" onclick="y"></div>')).toBe(
      '<p>a</p><div data-adjunto="2"></div>',
    );
    expect(sanitizeInformeHtml('<div data-adjunto="2 onclick=x">t</div>')).toBe('t');
    expect(sanitizeInformeHtml('<div class="x">t</div>')).toBe('t');
  });
});

describe('extraerMenciones', () => {
  it('extrae ids únicos y descarta al propio autor', () => {
    const html =
      '<p><span data-mention="2">A</span> <span data-mention="3">B</span> <span data-mention="2">A</span> <span data-mention="1">Yo</span></p>';
    expect(extraerMenciones(html, 1)).toEqual([2, 3]);
  });

  it('devuelve vacío sin spans', () => {
    expect(extraerMenciones('<p>@juan</p>', 1)).toEqual([]);
  });
});

describe('textoPlano', () => {
  it('separa bloques con salto de línea y decodifica entidades', () => {
    expect(textoPlano('<p>Título</p><p>a &lt; b</p><ul><li>x</li><li>y</li></ul>')).toBe(
      'Título\na < b\nx\ny',
    );
  });
});
