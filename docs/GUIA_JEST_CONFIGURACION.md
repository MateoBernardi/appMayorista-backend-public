# Guia de configuracion de Jest (backend)

Fecha: 2026-04-17

## Problemas encontrados

### 1) "jest no existe" o "jest no instalado"

Se observo que `jest` directo en terminal puede fallar aunque Jest este instalado en el proyecto.

Causa:

- Jest instalado localmente en `devDependencies`.
- Sin instalacion global de Jest en el sistema.
- Comando ejecutado fuera de `npm`/`npx`.

### 2) En VS Code, "Stop Runner" y "Start Runner" no reaccionan

Se observo que la extension Jest parecia no arrancar ni detenerse.

Causa:

- Entorno de la extension sin PATH de Node/NPM (caso frecuente con NVM).
- La extension no lograba resolver `npx`/`node`.

### 3) node_modules aparecia trackeado en Git

Se observo ruido masivo en `git status` con miles de entradas de `node_modules`.

Causa:

- `node_modules` habia quedado en estado trackeado en el indice.
- `.gitignore` por si solo no destrackea archivos ya versionados.

Resolucion aplicada:

- Se destrackeo `node_modules` del indice y se confirmo que sigue en disco.
- Se mantuvieron reglas de ignore para `node_modules`.

## Instalacion de Jest

En este repo Jest se instala como dependencia de desarrollo.

1. Instalar dependencias:

```bash
npm install
```

2. Verificar instalacion local:

```bash
npm ls jest --depth=0
```

3. Verificar ejecucion local:

```bash
npx jest --version
```

## Configuracion de Jest en VS Code

Configuracion actual del repo en [ .vscode/settings.json ](.vscode/settings.json):

- `jest.rootPath`: `.`
- `jest.jestCommandLine`: `npx jest --runInBand`
- `jest.pathToJest`: `npx jest --runInBand`
- `jest.nodeEnv.PATH`: incluye binarios de Node para entorno NVM
- `terminal.integrated.env.linux.PATH`: incluye Node + `node_modules/.bin`
- `testing.automaticallyOpenTestResults`: `neverOpen`

Objetivo de esta configuracion:

- Evitar dependencia de Jest global.
- Asegurar que la extension encuentre `node`, `npm` y `npx`.
- Mantener salida de tests controlada en VS Code.

## Desactivar corridas automaticas

Desde VS Code:

1. Abrir Settings (`Ctrl + ,`).
2. Buscar `Jest run mode` o `Jest auto run`.
3. Configurar:
  - Run mode: `On Demand`, o
  - Auto run: `Off`.

Si la extension no refleja el cambio:

1. `Developer: Reload Window`
2. `Jest: Stop Runner`
3. `Jest: Start Runner`

## Cheatsheet de ejecucion

### Correr toda la suite

```bash
npm test
```

o

```bash
npx jest
```

### Correr un archivo puntual

```bash
npm run test -- src/__tests__/licencias/calculateResiduoNuevo.test.ts
```

o

```bash
npx jest src/__tests__/licencias/calculateResiduoNuevo.test.ts
```

### Correr por nombre de test

```bash
npx jest -t "calculateResiduoNuevo"
```

### Correr en modo secuencial (evita issues de concurrencia)

```bash
npx jest --runInBand
```

### Ver version efectiva de Jest

```bash
npx jest --version
```

### Mostrar lista de tests detectados

```bash
npx jest --listTests --runInBand
```

## Troubleshooting rapido

1. Si `jest` directo falla pero `npx jest` funciona:
  - Es normal sin instalacion global.
  - Usar `npx jest` o `npm test`.

2. Si VS Code no corre tests:
  - Revisar Output > Jest.
  - Verificar que la extension Jest este habilitada.
  - Recargar ventana (`Developer: Reload Window`).

3. Si usas NVM y cambias de version de Node:
  - Abrir terminal nueva.
  - Revalidar con `node -v`, `npm -v`, `npx jest --version`.

4. Si vuelve a aparecer `node_modules` en Git:
  - Confirmar que `node_modules/` siga en `.gitignore`.
  - Recordar que el ignore no destrackea lo ya versionado.

## Recomendacion de equipo

- No depender de Jest global.
- Ejecutar con `npx jest` o `npm test`.
- Mantener [ .vscode/settings.json ](.vscode/settings.json) alineado al entorno del equipo.
