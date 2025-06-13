const fs = require('fs').promises;
const { OpenAI } = require('openai');
const axios = require('axios');
const fsSync = require('fs'); // <- nuevo alias para funciones síncronas como readFileSync
const fsExtra = require('fs-extra');
const archiver = require('archiver');
const path = require('path');
const { createWriteStream, rmSync, unlinkSync } = require('fs');
const proyectoService = require('../services/proyecto.service');
const sizeOf = require('image-size').imageSize;
const { v4: uuidv4 } = require('uuid'); // ← asegúrate de tener esto

function estimateFontSize(boxHeightPx) {
  if (boxHeightPx < 12) return 9;
  if (boxHeightPx < 16) return 11;
  if (boxHeightPx < 22) return 13;
  if (boxHeightPx < 28) return 14;
  if (boxHeightPx < 34) return 16;
  if (boxHeightPx < 40) return 18;
  if (boxHeightPx < 46) return 20;
  if (boxHeightPx < 54) return 21;
  if (boxHeightPx < 60) return 23;
  return 23; // máximo estimado
}

function responsiveFontSize(context, fontSize) {
  const screenWidth = context ? context.size.width : 375; // Default a 375 si no se pasa el contexto
  return fontSize * (screenWidth / 375); // Ajuste basado en un tamaño de referencia
}

const DETECTOR_SCHEMA = {
  name: 'detect_ui',
  description: 'Devuelve todos los componentes UI detectados en el boceto',
  parameters: {
    type: 'object',
    properties: {
      boxes: {
        type: 'array',
        items: {
          type: 'object',
          required: ['tipo', 'bb'],
          properties: {
            /* tipos válidos en tu editor */
            tipo: { enum: [
              'Label', 'InputBox', 'InputFecha', 'Boton',
              'Selector', 'Checkbox', 'Tabla', 'Link', 'Sidebar'
            ]},
            texto   : { type: 'string' },
            headers : { type: 'array',  items:{type:'string'} },
            filas   : { type: 'array',  items:{type:'array', items:{type:'string'}} },
            items   : { type: 'array',  items:{type:'object', properties:{texto:{type:'string'}}}},
            options : { type: 'array',  items:{type:'string'} },
            url     : { type: 'string' },
            bb: {
              type: 'object',
              required: ['x','y','w','h'],
              properties: {
                x:{type:'number'}, y:{type:'number'},
                w:{type:'number'}, h:{type:'number'}
              }
            }
          }
        }
      }
    },
    required: ['boxes']
  }
};

class ProyectoController {
  async crear(req, res) {
    try {
      const contenidoRecibido = JSON.parse(req.body.contenido || '{}');
  
      const contenidoConEstructura = {
        pestañas: contenidoRecibido.pestañas || [],
        clases: contenidoRecibido.clases || [],
        relaciones: contenidoRecibido.relaciones || [],
        clavesPrimarias: contenidoRecibido.clavesPrimarias || {}
      };
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
  
      const data = {
        ...req.body,
        idUsuario: req.usuario.idUsuario,
        contenido: JSON.stringify(contenidoConEstructura)
      };
  
      const proyecto = await proyectoService.crear(data);
      res.status(201).json(proyecto);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
  

  async listar(req, res) {
    const proyectos = await proyectoService.listar();
    res.json(proyectos);
  }

  async listarPorUsuario(req, res) {
    const proyectos = await proyectoService.listarPorUsuario(req.usuario.idUsuario);
    res.json(proyectos);
  }

  async obtener(req, res) {
    try {
      const proyecto = await proyectoService.obtenerPorId(req.params.id);
      res.json(proyecto);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  }

  async actualizar(req, res) {
    try {
      const contenidoRecibido = JSON.parse(req.body.contenido || '{}');

      // Normalizamos si faltan
      if (!Array.isArray(contenidoRecibido.pestañas)) {
        contenidoRecibido.pestañas = [];
      }
      if (!Array.isArray(contenidoRecibido.clases)) {
        contenidoRecibido.clases = [];
      }
      if (!Array.isArray(contenidoRecibido.relaciones)) {
        contenidoRecibido.relaciones = [];
      }
      if (typeof contenidoRecibido.clavesPrimarias !== 'object' || contenidoRecibido.clavesPrimarias === null) {
        contenidoRecibido.clavesPrimarias = {};
      }

      const dataActualizada = {
        contenido: JSON.stringify(contenidoRecibido),
      };

      const proyecto = await proyectoService.actualizar(req.params.id, req.usuario.idUsuario, dataActualizada);
      res.json(proyecto);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  

  async eliminar(req, res) {
    try {
      const resultado = await proyectoService.eliminar(req.params.id, req.usuario.idUsuario);
      res.json(resultado);
    } catch (err) {
      res.status(403).json({ error: err.message });
    }
  }

  async listarPermitidos(req, res) {
    try {
      const proyectos = await proyectoService.listarProyectosPermitidos(req.usuario.idUsuario);
      res.json(proyectos);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async listarInvitados(req, res) {
    try {
      const proyectos = await proyectoService.listarProyectosInvitado(req.usuario.idUsuario);
      res.json(proyectos);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  /* ----------------- EXPORTAR FLUTTER DINÁMICO ----------------- */
async exportarProyectoFlutter(req, res) {
  try {
    /* ---------- Paths y preparación de carpetas ---------- */
    const idProyecto = req.params.id;
    if (!idProyecto) return res.status(400).json({ error: 'Falta :id' });

    const plantillaDir = path.join(__dirname, '..', 'exportables', 'flutter-template');
    const tempDir     = path.join(__dirname, '..', 'temp', idProyecto);
    const zipPath     = path.join(__dirname, '..', 'temp', `${idProyecto}.zip`);

    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
    try { unlinkSync(zipPath); } catch {}

    await fsExtra.copy(plantillaDir, tempDir, {
      filter: (src) => {
        const rel = path.relative(plantillaDir, src);
        const ign = ['.dart_tool', '.gradle', '.idea', 'build', 'android/.gradle'];
        return !ign.some((c) => rel === c || rel.startsWith(`${c}${path.sep}`));
      },
    });

    /* ---------- Carga de datos ---------- */
    const proyectoDB = await proyectoService.obtenerPorId(idProyecto);
    if (!proyectoDB) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const contenido   = JSON.parse(proyectoDB.contenido || '{}');
    const pestañas    = contenido.pestañas   || [];
    const dispositivo = contenido.dispositivo || 'tablet';
    if (!pestañas.length) return res.status(400).json({ error: 'El proyecto no posee pestañas' });

    const libDir     = path.join(tempDir, 'lib');
    const screensDir = path.join(libDir,  'screens');
    await fs.mkdir(screensDir, { recursive: true });

    /* ---------- Aux ---------- */
const normalizarNombre = (nombre) => {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  const camel  = limpio.replace(/(^\w|\s\w)/g, (m) => m.toUpperCase()).replace(/\s/g, '');
  const file   = `pantalla_${limpio.toLowerCase().replace(/\s+/g, '')}.dart`;
  return {
    clase: `Pantalla${camel}`,
    file,
    ruta: `/${limpio.toLowerCase().replace(/\s+/g, '')}`, // ← corregido
  };
};


    /* =======================================================
       ==========   GENERACIÓN DE CADA PANTALLA   ============
       ======================================================= */
    for (const pest of pestañas) {
      /* --- set para widgets auxiliares de ESTA pantalla --- */
      const auxWidgets = new Set();
    let ovaloPainterAdded = false;
      /* --- función que crea cada widget individual --- */
      const generarWidget = (el) => {
        const { tipo, x, y, width, height, props } = el;
        const posWrap = (child) => `
          Positioned(
            left: constraints.maxWidth * ${x.toFixed(4)},
            top: constraints.maxHeight * ${y.toFixed(4)},
            width: constraints.maxWidth * ${width.toFixed(4)},
            height: constraints.maxHeight * ${height.toFixed(4)},
            child: ${child}
          ),`;
  
        switch (tipo) {
          case 'Label': {
            const leftPx   = `(constraints.maxWidth * ${x.toFixed(4)})`;
            const topPx    = `(constraints.maxHeight * ${y.toFixed(4)})`;
            const widthPx  = `(constraints.maxWidth * ${width.toFixed(4)})`;
            const heightPx = `(constraints.maxHeight * ${height.toFixed(4)})`;
            const fontSize = `(constraints.maxHeight * ${props.fontSize || 0.02})`;
            const color = `Color(0xFF${(props.color || '#000000').slice(1)})`;
            const fontWeight = props.bold ? 'FontWeight.bold' : 'FontWeight.normal';
            const textoEscapado = (props.texto || '').replace(/'/g, "\\'");

            return `
              Positioned(
                left: ${leftPx},
                top: ${topPx},
                width: ${widthPx},
                height: ${heightPx},
                child: Text(
                  '${textoEscapado}',
                  overflow: TextOverflow.ellipsis,
                  maxLines: 1,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: ${fontSize},
                    fontWeight: ${fontWeight},
                    color: ${color}
                  )
                )
              ),`;
          }

case 'Parrafo': {
  const leftPx   = `(constraints.maxWidth * ${x.toFixed(4)})`;
  const topPx    = `(constraints.maxHeight * ${y.toFixed(4)})`;
  const widthPx  = `(constraints.maxWidth * ${width.toFixed(4)})`;
  const heightPx = `(constraints.maxHeight * ${height.toFixed(4)})`;
  const fontSize = `(constraints.maxHeight * ${props.fontSize.toFixed(2) || 0.02})`;
  const color = `Color(0xFF${(props.color || '#000000').slice(1)})`;
  const fontWeight = props.bold ? 'FontWeight.bold' : 'FontWeight.normal';
  const textAlign = `TextAlign.${props.align || 'left'}`;
  const textoEscapado = `'''${(props.texto || '').replace(/'''/g, "''")}'''`;

  return `
            Positioned(
              left: ${leftPx},
              top: ${topPx},
              width: ${widthPx},
              height: ${heightPx},
              child: Text(
                ${textoEscapado},
                softWrap: true,
                overflow: TextOverflow.visible,
                maxLines: null,
                textAlign: ${textAlign},
                style: TextStyle(
                  fontSize: ${fontSize},
                  fontWeight: ${fontWeight},
                  color: ${color},
                ),
              ),
            ),`;
}


          case 'Imagen':
  return `
                    Positioned(
                      left: constraints.maxWidth * ${el.x.toFixed(4)},
                      top: constraints.maxHeight * ${el.y.toFixed(4)},
                      width: constraints.maxWidth * ${el.width.toFixed(4)},
                      height: constraints.maxHeight * ${el.height.toFixed(4)},
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(${el.props.borderRadius}),
                        child: Image.network(
                           '${process.env.FLUTTER_API_URL}/api/archivos/${el.props.idArchivo}/descargar',
                          fit: BoxFit.cover,
                          errorBuilder: (context, error, stackTrace) => Center(
                            child: Icon(Icons.broken_image, size: 30),
                          ),
                        ),
                      ),
                    ),`;
case 'Video':
  return `
    Positioned(
      left: constraints.maxWidth * ${el.x.toFixed(4)},
      top: constraints.maxHeight * ${el.y.toFixed(4)},
      width: constraints.maxWidth * ${el.width.toFixed(4)},
      height: constraints.maxHeight * ${el.height.toFixed(4)},
      child: ClipRRect(
        borderRadius: BorderRadius.circular(${el.props.borderRadius}),
        child: VideoPlayerWidget(
          url: '${process.env.FLUTTER_API_URL}/api/archivos/${el.props.idArchivo}/descargar',
        ),
      ),
    ),`;


case 'Audio':
  return `
    Positioned(
      left: constraints.maxWidth * ${el.x.toFixed(4)},
      top: constraints.maxHeight * ${el.y.toFixed(4)},
      width: constraints.maxWidth * ${el.width.toFixed(4)},
      height: constraints.maxHeight * ${el.height.toFixed(4)},
      child: AudioPlayerWidget(
        url: '${process.env.FLUTTER_API_URL}/api/archivos/${el.props.idArchivo}/descargar',
      ),
    ),`;


          case 'Checkbox': {
            const id = `CheckBox${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;
            const label = (props.texto || 'Opción').replace(/'/g, "\\'");
            const fontSize = +(props.fontSize || 0.02).toFixed(4);

            auxWidgets.add(`
          class _${id} extends StatefulWidget {
            final double fontSizeFactor;
            final double boxSizeFactor;
            const _${id}(this.fontSizeFactor, this.boxSizeFactor, {super.key});
            @override
            State<_${id}> createState() => _${id}State();
          }

          class _${id}State extends State<_${id}> {
            bool checked = false;

            @override
            Widget build(BuildContext context) {
              final fontSize = MediaQuery.of(context).size.height * widget.fontSizeFactor;
              final boxSize  = MediaQuery.of(context).size.height * widget.boxSizeFactor * 0.2;

              return GestureDetector(
                onTap: () => setState(() => checked = !checked),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Container(
                      width: boxSize,
                      height: boxSize,
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.black54),
                        borderRadius: BorderRadius.circular(4),
                        color: checked ? Colors.blue : Colors.white,
                      ),
                      child: checked
                        ? const Icon(Icons.check, size: 16, color: Colors.white)
                        : null,
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        '${label}',
                        style: TextStyle(fontSize: fontSize),
                        overflow: TextOverflow.ellipsis,
                        maxLines: 1,
                      ),
                    ),
                  ],
                ),
              );
            }
          }
            `);

            return posWrap(`_${id}(
              ${fontSize},
              ${el.height.toFixed(4)}  // ← se usa la altura del bounding box como base del cuadrado
            )`);
          }


case 'Boton': {
  const texto = (props.texto || 'Botón').replace(/'/g, "\\'");
  const color = `Color(0xFF${(props.color || '#2563eb').replace('#', '')})`;
  const textColor = `Color(0xFF${(props.textColor || '#ffffff').replace('#', '')})`;
  const radius = +(props.borderRadius || 8);
  const fontSize = +(props.fontSize || 0.02).toFixed(4);

  return posWrap(`Container(
    decoration: BoxDecoration(
      color: ${color},
      borderRadius: BorderRadius.circular(${radius}),
    ),
    child: Center(
      child: Text(
        '${texto}',
        textAlign: TextAlign.center,
        style: TextStyle(
          color: ${textColor},
          fontSize: MediaQuery.of(context).size.height * ${fontSize},
          fontWeight: FontWeight.w500
        ),
      ),
    ),
  )`);
}
case 'Link': {
  const texto = (props.texto || 'Enlace').replace(/'/g, "\\'");
  const url = (props.url || '').replace(/'/g, "\\'");
  const color = `Color(0xFF${(props.color || '#2563eb').replace('#', '')})`;
  const fontSize = +(props.fontSize || 0.02).toFixed(4);

  return posWrap(`GestureDetector(
    onTap: () async {
      final uri = Uri.tryParse('${url}');
      if (uri != null && await canLaunchUrl(uri)) {
        await launchUrl(uri, mode: LaunchMode.externalApplication);
      }
    },
    child: Text(
      '${texto}',
      overflow: TextOverflow.ellipsis,
      maxLines: 1,
      style: TextStyle(
        color: ${color},
        fontSize: MediaQuery.of(context).size.height * ${fontSize},
        decoration: TextDecoration.underline,
      ),
    ),
  )`);
}

case 'Tabla': {
  const headers = props.headers || [];
  const data = props.data || [];
  const colWidths = props.colWidths || [];
  const fontSize = +(props.fontSize || 0.02).toFixed(4);
  const colCount = headers.length;
  const id = `Tabla${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;

  auxWidgets.add(`
class _${id} extends StatelessWidget {
  final double fontSize;
  final List<String> headers;
  final List<List<String>> data;
  final List<double> colWidths;

  const _${id}({
    required this.fontSize,
    required this.headers,
    required this.data,
    required this.colWidths,
    super.key,
  });

  @override
  Widget build(BuildContext context) {
    final realFontSize = MediaQuery.of(context).size.height * fontSize;
    final scrollControllerY = ScrollController();
    final scrollControllerX = ScrollController();

    return Scrollbar(
      controller: scrollControllerY,
      thumbVisibility: true,
      child: SingleChildScrollView(
        controller: scrollControllerY,
        child: Scrollbar(
          controller: scrollControllerX,
          thumbVisibility: true,
          notificationPredicate: (notif) => notif.depth == 1,
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            controller: scrollControllerX,
            child: Column(
              children: [
                Row(
                  children: List.generate(headers.length, (i) {
                    return Container(
                      padding: const EdgeInsets.all(6),
                      alignment: Alignment.center,
                      width: MediaQuery.of(context).size.width * colWidths[i],
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.black26),
                        color: Color(0xFFE5E7EB),
                      ),
                      child: Text(
                        headers[i],
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: realFontSize,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    );
                  }),
                ),
                ...data.map((fila) {
                  return Row(
                    children: List.generate(headers.length, (i) {
                      return Container(
                        padding: const EdgeInsets.all(6),
                        alignment: Alignment.center,
                        width: MediaQuery.of(context).size.width * colWidths[i],
                        decoration: BoxDecoration(
                          border: Border.all(color: Colors.black12),
                          color: Color(0xFFFFFFFF),
                        ),
                        child: Text(
                          fila[i],
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: realFontSize,
                          ),
                        ),
                      );
                    }),
                  );
                }).toList(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
  `);

  // Dart-safe serialization
  const safe = (str) => str.replace(/'/g, "\\'");

  const dartHeaders = `[${headers.map(h => `'${safe(h)}'`).join(',')}]`;
  const dartData = `[${data.map(row => `[${row.map(c => `'${safe(c)}'`).join(',')}]`).join(',')}]`;
  const dartColWidths = `[${colWidths.join(',')}]`;

  return posWrap(`_${id}(
    fontSize: ${fontSize},
    headers: ${dartHeaders},
    data: ${dartData},
    colWidths: ${dartColWidths},
  )`);
}

case 'Cuadrado': {
  const x = el.x || 0;
  const y = el.y || 0;
  const width = el.width || 1;
  const height = el.height || 1;
  const color = el.props?.color || '#000000';
  const borderRadius = el.props?.borderRadius ?? 0;
  const corners = el.props?.borderCorners || {};

  const id = `Cuadrado${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;

  auxWidgets.add(`
  class _${id} extends StatelessWidget {
    final double width;
    final double height;
    final Color color;

    const _${id}({
      required this.width,
      required this.height,
      required this.color,
      super.key,
    });

    @override
    Widget build(BuildContext context) {
      return Container(
        width: width * MediaQuery.of(context).size.width,
        height: height * MediaQuery.of(context).size.height,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.only(
            ${corners.topLeft ? `topLeft: Radius.circular(${borderRadius}),` : ''}
            ${corners.topRight ? `topRight: Radius.circular(${borderRadius}),` : ''}
            ${corners.bottomLeft ? `bottomLeft: Radius.circular(${borderRadius}),` : ''}
            ${corners.bottomRight ? `bottomRight: Radius.circular(${borderRadius}),` : ''}
          ),
        ),
      );
    }
  }
  `);

  const dartColor = color.replace('#', '');

  return posWrap(`_${id}(
    width: ${width},
    height: ${height},
    color: Color(0xFF${dartColor}),
  )`);
}


case 'Circulo': {
    // Imprimir todo el objeto `el` para ver qué datos tiene
  console.log(`Datos de el: ${JSON.stringify(el, null, 2)}`);

  // Aquí obtenemos las propiedades del círculo y las pasamos correctamente
  const x = el.x || 1;  // Siempre 1 para mantener la proporción
  const y = el.y || 1;  // Siempre 1 para mantener la proporción
  const width = el.width || 1;  // Siempre 1 para mantener la proporción
  const height = el.height || 1;  // Siempre 1 para mantener la proporción
  const color = el.props?.color || '#000000';  // Color hexadecimal

  // Imprimir el valor de color para asegurarte de que está llegando correctamente
  console.log(`Color asignado para el Circulo (id: ${el.id}): ${color}`);
  // Aseguramos que solo se añada la clase _Circulo y OvaloPainter una vez
  if (!ovaloPainterAdded) {
    auxWidgets.add(`
      class _Circulo extends StatelessWidget {
        final double x;
        final double y;
        final double width;
        final double height;
        final String color;

        const _Circulo({
          required this.x,
          required this.y,
          required this.width,
          required this.height,
          required this.color,
          super.key,
        });

        @override
        Widget build(BuildContext context) {
          return CustomPaint(
            size: Size(MediaQuery.of(context).size.width, MediaQuery.of(context).size.height),
            painter: OvaloPainter(x: x, y: y, width: width, height: height, color: color),
          );
        }
      }

      class OvaloPainter extends CustomPainter {
        final double x;
        final double y;
        final double width;
        final double height;
        final String color;

        OvaloPainter({
          required this.x,
          required this.y,
          required this.width,
          required this.height,
          required this.color,
        });

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = Color(int.parse("0xFF${color.replaceAll('#', '')}"))
      ..style = PaintingStyle.fill;

    // Dibujamos el óvalo en las proporciones proporcionadas
    canvas.drawOval(
      Rect.fromLTWH(
         x,  // Escalado de la posición X
         y, // Escalado de la posición Y
        size.width * width,  // Ancho proporcional al tamaño de la pantalla
        size.height * height, // Alto proporcional al tamaño de la pantalla
      ),
      paint,
    );
  }

        @override
        bool shouldRepaint(covariant CustomPainter oldDelegate) {
          return false;
        }
      }
    `);
    ovaloPainterAdded = true;
  }

  // Generamos el widget Positioned para este círculo con el comportamiento esperado
  return posWrap(`
    Positioned(
      left: constraints.maxWidth * ${x.toFixed(4)},  // Multiplicamos por 1 para mantener el comportamiento
      top: constraints.maxHeight * ${y.toFixed(4)},  // Multiplicamos por 1 para mantener el comportamiento
      width: constraints.maxWidth * ${width.toFixed(4)},  // Multiplicamos por 1 para mantener el comportamiento
      height: constraints.maxHeight * ${height.toFixed(4)},  // Multiplicamos por 1 para mantener el comportamiento
      child: _Circulo(
        x: 1,  // Mantener 1
        y: 1,  // Mantener 1
        width: 1,  // Mantener 1
        height: 1,  // Mantener 1
        color: '${color}',  // Color hexadecimal
      ),
    )
  `);
}




          case 'InputBox': {
            const id = `InputBox${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;
            const placeholder = (props.placeholder || 'Ingrese texto...').replace(/'/g, "\\'");
            const fontSize = +(props.fontSize || 0.02).toFixed(4);

            auxWidgets.add(`
          class _${id} extends StatefulWidget {
            final double width;
            final double height;
            final double fontSizeFactor;
            const _${id}(this.width, this.height, this.fontSizeFactor, {super.key});
            @override
            State<_${id}> createState() => _${id}State();
          }

          class _${id}State extends State<_${id}> {
            final FocusNode _focusNode = FocusNode();
            final TextEditingController _controller = TextEditingController();

            @override
            Widget build(BuildContext context) {
              double realFontSize = MediaQuery.of(context).size.height * widget.fontSizeFactor;

              return GestureDetector(
                onTap: () => FocusScope.of(context).requestFocus(_focusNode),
                child: Container(
                  width: widget.width,
                  height: widget.height,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: Colors.black54),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  alignment: Alignment.centerLeft,
                  child: Stack(
                    children: [
                      if (_controller.text.isEmpty && !_focusNode.hasFocus)
                        Positioned.fill(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              '${placeholder}',
                              style: TextStyle(
                                color: Colors.black38,
                                fontSize: realFontSize,
                              ),
                            ),
                          ),
                        ),
                      EditableText(
                        controller: _controller,
                        focusNode: _focusNode,
                        style: TextStyle(fontSize: realFontSize, color: Colors.black),
                        cursorColor: Colors.blue,
                        backgroundCursorColor: Colors.transparent,
                        maxLines: 1,
                      ),
                    ],
                  ),
                ),
              );
            }
          }
            `);

            return posWrap(`_${id}(
              constraints.maxWidth * ${el.width.toFixed(4)},
              constraints.maxHeight * ${el.height.toFixed(4)},
              ${fontSize}
            )`);
          }


          case 'InputFecha': {
            const id = `InputFecha${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;
            const placeholder = (props.placeholder || 'dd/mm/aaaa').replace(/'/g, "\\'");
            const fontSize = +(props.fontSize || 0.02).toFixed(4);

            auxWidgets.add(`
          class _${id} extends StatefulWidget {
            final double width;
            final double height;
            final double fontSizeFactor;
            const _${id}(this.width, this.height, this.fontSizeFactor, {super.key});
            @override
            State<_${id}> createState() => _${id}State();
          }

          class _${id}State extends State<_${id}> {
            final FocusNode _focusNode = FocusNode();
            final TextEditingController _controller = TextEditingController();
            DateTime? selectedDate;

            Future<void> _selectDate() async {
              final picked = await showDatePicker(
                context: context,
                initialDate: selectedDate ?? DateTime.now(),
                firstDate: DateTime(1900),
                lastDate: DateTime(2100),
              );
              if (picked != null) {
                setState(() {
                  selectedDate = picked;
                  _controller.text = "\${picked.toLocal()}".split(' ')[0];
                });
              }
            }

            @override
            Widget build(BuildContext context) {
              double realFontSize = MediaQuery.of(context).size.height * widget.fontSizeFactor;

              return GestureDetector(
                onTap: _selectDate,
                child: Container(
                  width: widget.width,
                  height: widget.height,
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: Colors.black54),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  alignment: Alignment.centerLeft,
                  child: Stack(
                    children: [
                      if (_controller.text.isEmpty)
                        Positioned.fill(
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: Text(
                              '${placeholder}',
                              style: TextStyle(color: Colors.black38, fontSize: realFontSize),
                            ),
                          ),
                        ),
                      IgnorePointer(
                        ignoring: true,
                        child: EditableText(
                          controller: _controller,
                          focusNode: _focusNode,
                          style: TextStyle(fontSize: realFontSize, color: Colors.black),
                          cursorColor: Colors.transparent,
                          backgroundCursorColor: Colors.transparent,
                          maxLines: 1,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }
          }
            `);

            return posWrap(`_${id}(
              constraints.maxWidth * ${el.width.toFixed(4)},
              constraints.maxHeight * ${el.height.toFixed(4)},
              ${fontSize}
            )`);
          }



          case 'Selector': {
            const id = `Dropdown${el.id.replace(/[^a-zA-Z0-9]/g, '')}`;
            const leftPx   = `(constraints.maxWidth * ${x.toFixed(4)})`;
            const topPx    = `(constraints.maxHeight * ${y.toFixed(4)})`;
            const widthPx  = `(constraints.maxWidth * ${width.toFixed(4)})`;
            const heightPx = `(constraints.maxHeight * ${height.toFixed(4)})`;
            const fontSize = `(MediaQuery.of(context).size.height * ${props.fontSize || 0.02})`;
            const options = props.options || [];

            // Serializamos las opciones de forma segura para Dart
            const dartOptions = `[${options.map(o => `'${o.replace(/'/g, "\\'")}'`).join(',')}]`;

            // Widget auxiliar único
            auxWidgets.add(`
          class _${id} extends StatefulWidget {
            const _${id}({super.key});
            @override
            State<_${id}> createState() => _${id}State();
          }

          class _${id}State extends State<_${id}> {
            String? val = ${dartOptions}.first;

          @override
          Widget build(BuildContext context) {
            return Container(
              decoration: BoxDecoration(
                border: Border.all(color: Colors.grey), // Borde igual al InputBox
                borderRadius: BorderRadius.circular(4),
                color: Colors.white
              ),
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: DropdownButton<String>(
                isExpanded: true,
                value: val,
                underline: const SizedBox.shrink(), // Quitamos la línea inferior por defecto
                style: TextStyle(
                  fontSize: ${fontSize},
                  color: Colors.black,
                ),
                dropdownColor: Colors.white,
                items: ${dartOptions}.map<DropdownMenuItem<String>>(
                  (o) => DropdownMenuItem(
                    value: o,
                    child: Text(
                      o,
                      textAlign: TextAlign.center,
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  )
                ).toList(),
                onChanged: (v) => setState(() => val = v),
              ),
            );
          }

          }
            `);

            // Componente posicionado
            return `
              Positioned(
                left: ${leftPx},
                top: ${topPx},
                width: ${widthPx},
                height: ${heightPx},
                child: const _${id}()
              ),`;
          }


          default:
            return posWrap('SizedBox.shrink()');
        }
      };

      /* ---------- Variables de pantalla ---------- */
      const { clase, file } = normalizarNombre(pest.name);
      const canvasSize =
        dispositivo === 'tablet'       ? 'Size(800,1335)' :
        dispositivo === 'mobile-small' ? 'Size(360,640)' :
                                         'Size(414,896)';

      const widgets = pest.elementos
        .filter((e) => e.tipo !== 'Sidebar')
        .map(generarWidget)
        .join('\n              ');
const bottomNavbar = pest.elementos.find((e) => e.tipo === 'BottomNavbar');
const sidebar = pest.elementos.find((e) => e.tipo === 'Sidebar');
const items = sidebar?.props?.items?.map((it) => `
              Container(
                margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                decoration: BoxDecoration(
                  color: const Color(0xFF374151),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: ListTile(
                  dense: true,
                  title: Text('${it.texto}', style: const TextStyle(color: Colors.white)),
                  onTap: () => Navigator.pushReplacementNamed(
                    context, '/${it.nombrePestana.replace(/\s+/g, '')}'),
                ),
              ),`).join('') || '';

const navbarItems = bottomNavbar?.props?.items?.map((it, index) => `
  GestureDetector(
    onTap: () => setState(() {
      selectedIndex = ${index};  // Cambia el índice cuando el ítem es tocado
    }),
    child: Container(
      padding: EdgeInsets.symmetric(vertical: 10),
      color: selectedIndex == ${index} ? Color(0xFF${bottomNavbar.props.colorActivo.replace('#', '')}) : Color(0xFF${bottomNavbar.props.colorInactivo.replace('#', '')}),
      child: Column(
        children: [
          Icon(
            Icons.${it.icono}, // Asumimos que se está usando un ícono como 'user' o 'video'
            size: MediaQuery.of(context).size.height * ${bottomNavbar.props.fontSize},
            color: selectedIndex == ${index} ? Colors.white : Color(0xFF${bottomNavbar.props.colorInactivo.replace('#', '')}),
          ),
          Text(
            '${it.label}',
            style: TextStyle(
              fontSize: MediaQuery.of(context).size.height * ${bottomNavbar.props.fontSize},
              color: selectedIndex == ${index} ? Colors.white : Color(0xFF${bottomNavbar.props.colorInactivo.replace('#', '')}),
            ),
          ),
        ],
      ),
    ),
  ),
`).join('') || '';

const bottomNavbarWidth = bottomNavbar?.width || 1.0;  // Toma el valor de la base de datos para el ancho
const bottomNavbarHeight = bottomNavbar?.height || 0.1; // Toma el valor de la base de datos para la altura
const fontSize = bottomNavbar?.props?.fontSize || 0.0237; // Toma el valor de la base de datos para el tamaño de fuente
const colorActivo = bottomNavbar?.props?.colorActivo || '#2563eb'; // Toma el valor de la base de datos para el color activo
const colorInactivo = bottomNavbar?.props?.colorInactivo || '#666666'; // Toma el valor de la base de datos para el color inactivo
const fondo = bottomNavbar?.props?.fondo || '#ffffff'; // Toma el valor de la base de datos para el fondo
const borderRadius = bottomNavbar?.props?.borderRadius || 6; // Toma el valor de la base de datos para el radio de los bordes
const iconSize = bottomNavbar?.props?.iconSize || 0.0391; // Toma el valor de la base de datos para el tamaño de los íconos
const selectedIndexDefault = bottomNavbar
  ? bottomNavbar.props.items.findIndex(it => it.nombrePestana.replace(/\s+/g, '') === pest.name.replace(/\s+/g, '')) ?? 0
  : 0;

/* ---------- Código final .dart de la pantalla ---------- */
const pantallaCode = `
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart'; // ← IMPORTANTE
import 'package:url_launcher/url_launcher.dart';
import 'package:prueba2/widgets/video_player_widget.dart';
import 'package:prueba2/widgets/audio_player_widget.dart';

/* ==== Widgets auxiliares generados ==== */
${[...auxWidgets].join('\n\n')}

class ${clase} extends StatefulWidget {
  @override
  State<${clase}> createState() => _${clase}State();
}

class _${clase}State extends State<${clase}> {
  bool visible = ${sidebar ? sidebar.props.visible : true};
  int selectedIndex = ${selectedIndexDefault};

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      resizeToAvoidBottomInset: false,
      body: Center(
        child: SizedBox(
          width: ${canvasSize}.width,
          height: ${canvasSize}.height,
          child: LayoutBuilder(
            builder: (context, constraints) {
              return GestureDetector(
                behavior: HitTestBehavior.translucent,
                onTap: () => FocusScope.of(context).unfocus(),
                child: Stack(
                  clipBehavior: Clip.none,
                  children: [
                    ${widgets}
                    ${sidebar ? `

                    /* ---------- Sidebar ---------- */
                    AnimatedPositioned(
                      duration: const Duration(milliseconds: 0),
                      left: visible ? constraints.maxWidth * ${sidebar.x.toFixed(4)} : -constraints.maxWidth * ${sidebar.width.toFixed(4)},
                      top: constraints.maxHeight * ${sidebar.y.toFixed(4)},
                      width: constraints.maxWidth * ${sidebar.width.toFixed(4)},
                      height: constraints.maxHeight * ${sidebar.height.toFixed(4)},
                      child: Material(
                        elevation: 8,
                        color: Color(0xFF${sidebar.props.bgColor.replace('#', '')}),
                        borderRadius: BorderRadius.circular(${sidebar.props.borderRadius}),
                        child: Padding(
                          padding: const EdgeInsets.only(top: 16, left: 8, right: 8),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('${sidebar.props.titulo}',
                                  style: TextStyle(
                                    color: Color(0xFF${sidebar.props.textColor.replace('#', '')}),
                                    fontSize: MediaQuery.of(context).size.height * ${sidebar.props.fontSize})),
                              const SizedBox(height: 12),
                              Expanded(
                                child: ListView(
                                  children: [
                                    ${sidebar.props.items.map((item) => `
                                    Container(
                                      margin: const EdgeInsets.symmetric(vertical: 4, horizontal: 8),
                                      decoration: BoxDecoration(
                                        color: Color(0xFF${sidebar.props.itemBgColor.replace('#', '')}),
                                        borderRadius: BorderRadius.circular(6),
                                      ),
                                      child: ListTile(
                                        dense: true,
                                        title: Text(
                                          '${item.texto}',
                                          style: const TextStyle(color: Colors.white),
                                        ),
                                        onTap: () => Navigator.pushReplacementNamed(
                                          context, '/${item.nombrePestana.replace(/\s+/g, '')}'),
                                      ),
                                    ),
                                    `).join('')}
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),

                    /* ---------- Botón toggle ---------- */
                    AnimatedPositioned(
                      duration: const Duration(milliseconds: 0),
                      left: visible
                        ? constraints.maxWidth * ${sidebar.x.toFixed(4)} + constraints.maxWidth * ${sidebar.width.toFixed(4)} - 50
                        : constraints.maxWidth * ${sidebar.x.toFixed(4)} + 20,
                      top: constraints.maxHeight * ${sidebar.y.toFixed(4)} + 16,
                      child: GestureDetector(
                        onTap: () => setState(() => visible = !visible),
                        child: Container(
                          width: 32,
                          height: 32,
                          decoration: BoxDecoration(
                            color: Color(0xFF${sidebar.props.itemBgColor.replace('#', '')}),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: const Icon(Icons.menu, color: Colors.white, size: 20),
                        ),
                      ),
                    ),
                    ` : ''}

                    ${bottomNavbar ? `

                    /* ---------- BottomNavbar ---------- */
                    Positioned(
                      left: constraints.maxWidth * ${bottomNavbar.x.toFixed(4)},
                      top: constraints.maxHeight * ${bottomNavbar.y.toFixed(4)},
                      width: constraints.maxWidth * ${bottomNavbarWidth},
                      height: constraints.maxHeight * ${bottomNavbarHeight},

                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(${bottomNavbar.props.borderRadius}),
                        child: Container(
                          decoration: BoxDecoration(
                            color: Color(0xFF${bottomNavbar.props.fondo.replace('#', '')}),
                          ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: [
                            ${bottomNavbar.props.items.map((it, index) => `
                              GestureDetector(
                                onTap: () {
                       if (selectedIndex != ${index}) {
                                    setState(() {
                                      selectedIndex = ${index};
                                    });
                                    Navigator.pushReplacementNamed(
                                      context, '/${it.nombrePestana.replace(/\s+/g, '')}');
                                  }
                                },
                                child: Container(
                                  width: (constraints.maxWidth * ${bottomNavbarWidth}) / ${bottomNavbar.props.items.length}, // Ajuste de ancho uniforme
                                  padding: EdgeInsets.symmetric(vertical: 10),
                                  decoration: BoxDecoration(
                                    color: Color(0xFF${bottomNavbar.props.fondo.replace('#', '')}),  // Fondo blanco
                                    border: Border(top: BorderSide(color: selectedIndex == ${index} ? Color(0xFF${bottomNavbar.props.colorActivo.replace('#', '')}) : Colors.transparent, width: 3)),  // Linea azul al seleccionar
                                  ),
                                  child: Column(
                                    mainAxisAlignment: MainAxisAlignment.center,
                                    children: [
                                      SvgPicture.asset(
                                        'assets/icons/${it.icono}.svg',
                                        height: MediaQuery.of(context).size.height * ${bottomNavbar.props.iconSize},
                                        colorFilter: ColorFilter.mode(
                                          selectedIndex == ${index} ? Color(0xFF${bottomNavbar.props.colorActivo.replace('#', '')}) : Color(0xFF${bottomNavbar.props.colorInactivo.replace('#', '')}), // Color de íconos
                                          BlendMode.srcIn,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        '${it.label}',
                                        style: TextStyle(
                                          fontSize: MediaQuery.of(context).size.height * ${bottomNavbar.props.fontSize},
                                          color: selectedIndex == ${index} ? Color(0xFF${bottomNavbar.props.colorActivo.replace('#', '')}) : Color(0xFF${bottomNavbar.props.colorInactivo.replace('#', '')}),  // Texto azul al seleccionar
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),`).join('')}

                          ],
                        ),
                      ),
                    ),),
                    ` : ''}
                  ],
                ),
              );
            }
          ),
        ),
      ),
    );
  }
}
`;


await fs.writeFile(path.join(screensDir, file), pantallaCode);

    } /* fin for de pestañas */

    /* ---------- main.dart ---------- */
    const imports = pestañas
      .map((p) => `import 'screens/${normalizarNombre(p.name).file}';`)
      .join('\n');
    const rutas = pestañas
      .map((p) => {
        const { ruta, clase } = normalizarNombre(p.name);
        return `'${ruta}': (context) => ${clase}(),`;
      })
      .join('\n        ');
    const homeClase = normalizarNombre(pestañas[0].name).clase;

    const mainCode = `
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
${imports}

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.manual, overlays: []);
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Proyecto exportado',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(useMaterial3: true),
      home: ${homeClase}(),
      routes: {
        ${rutas}
      },
    );
  }
}
`;
    await fs.writeFile(path.join(libDir, 'main.dart'), mainCode);

    /* ---------- ZIP y descarga ---------- */
    const output  = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', (err) => {
      console.error('[EXPORTAR] ZIP:', err);
      return res.status(500).json({ error: 'Error al crear ZIP' });
    });

    archive.pipe(output);
    archive.directory(tempDir, false);
    await archive.finalize();

    await new Promise((ok, err) => {
      output.on('close', ok);
      output.on('error', err);
    });

    res.download(zipPath, `${proyectoDB.nombre}.zip`, (err) => {
      if (err) console.error('[EXPORTAR] envío:', err);
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      try { unlinkSync(zipPath); } catch {}
    });
  } catch (error) {
    console.error('[EXPORTAR] Error general:', error);
    res.status(500).json({ error: 'No se pudo exportar el proyecto Flutter.' });
  }
}

async importarBoceto(req, res) {
  try {
    const { nombre, descripcion } = req.body;
    if (!nombre || !descripcion)
      return res.status(400).json({ error: 'Faltan el nombre o la descripción del proyecto.' });

    /* ─── 0. Validación ─── */
    if (!req.file)
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext))
      return res.status(400).json({ error: 'Formato no válido. Solo PNG o JPG.' });

    /* ─── 1. Convertir imagen a base64 ─── */
    const rutaImg = req.file.path;
    const buffer = await fs.readFile(rutaImg);
    const { width: W, height: H } = sizeOf(buffer);
    const base64 = buffer.toString('base64');
    const base64URL = `data:image/${ext.replace('.', '')};base64,${base64}`;

    /* ─── 2. Prompt corto de prueba ─── */
    const prompt = `Eres un diseñador UI experto en interfaces móviles. Recibirás una imagen de un boceto perfectamente recortado (sin márgenes ni bordes). Tu tarea es *reconstruir exactamente* todos los componentes visuales como una estructura JSON válida que represente la UI detectada, quiero que detecteslas ubicaciones reales y las normalices siempre, ya que debería verse bien en cualquier dispositivo.
Si hay Sidebar pon su zIndex en 100 para que esté por encima de todos los demás componentes.
JAMAS mezclez un label con un inputbox, si en el boceto el usuario pone un label y debajo un inputbox o a un lado, debes devolverlos como dos componentes distintos, no los mezcles en uno solo.
Si ves algo parecido a un botón pero al final del lienzo verticalmente hablando tomalo como un BottomNavbar, no como botón
---

📌 INSTRUCCIONES GENERALES:

1. Analiza visualmente la imagen.
2. Detecta componentes válidos: Label, Parrafo, InputBox, InputFecha, Boton, Link, Tabla, Checkbox, Selector, Sidebar, BottomNavbar, Cuadrado, Circulo, Imagen, Video, Audio.
3. Devuelve una única pestaña:
   - id: "tab1"
   - name: "Pantalla 1"
   - elementos: todos los componentes detectados.
4. Para cada componente devuelve:
   - x, y, width, height: coordenadas normalizadas entre 0.0 y 1.0
   - fontSize: proporción de altura del texto respecto al alto total de la imagen, normalmente los fontsize están entre 0.02 y 0.035. valor minimo(0) valor maximo(1)
   - zIndex: es cuando hay varias elementos superpuestos, para saber cual va encima de otro 


---

📦 DETECCIÓN AVANZADA:

- *Sidebar*:
  - Si un Label cae completamente dentro del Sidebar:
    - El más alto será props.titulo, OJO A VECES NO HAY TITULO SI NO HAY TITULO TOMA TODOS LOS LABELS COMO ITEMS.
    - Los demás serán props.items[].
    - No los devuelvas como elementos independientes fuera del Sidebar.
    - El sidebar Siempre estará por encima de todos los demas componentes gracias al zIndex

- *Selector desplegado*:
  - Si ves una caja con una opción visible y debajo varias líneas de texto en recuadros del mismo ancho, el selector puedes identificarlo ya que tiene como una flechita en el lado derecho:
    - Interprétalo como un Selector.
    - props.texto: opción seleccionada
    - props.options[]: todas las opciones visibles, incluyendo la seleccionada

---


### 🎨 Especificación de cada componente:

#### 🔹 Label
- Props: texto, fontSize, color, bold
- Úsalo para títulos, subtítulos o etiquetas de campos.
- Label lamentablemente no tiene multilinea así que si quieres que poner multilineas tendras que usar un label por linea
- NO PONGAS FONTSIZE GRANDES con mucho texto, porque se puede salir del contenedor o cortar líneas, toma en cuenta que los fontsize sí son grandes, por ende colocales valores relativamente bajos porque los dispositivos moviles no son muy grandes.

#### 🔹 Parrafo
- Props: texto, fontSize, color, bold, align
- Úsalo para bloques de texto largo, como descripciones, explicaciones o contenido informativo.
- A diferencia de Label, Parrafo **sí soporta multilinea**, tanto automática como manual con \n.
- align puede ser "left", "center", "right" o "justify" para alinear el texto según lo necesites.
- NO PONGAS FONTSIZE GRANDES con mucho texto, porque se puede salir del contenedor o cortar líneas, toma en cuenta que los fontsize sí son grandes, por ende colocales valores relativamente bajos porque los dispositivos moviles no son muy grandes.
- Si querés un fondo detrás del texto, podés envolver el Parrafo dentro de un componente Cuadrado.


#### 🔹 InputBox
- Props: placeholder, fontSize
- Úsalo para nombres, correos, textos cortos.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 InputFecha
- Props: placeholder, fontSize
- Campo para seleccionar una fecha.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 Boton
- Props: texto, color, textColor, borderRadius, fontSize
- Es un botón interactivo. Siempre requiere un texto.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 Link
- Props: texto, url, fontSize, color
- Es un enlace. Asegúrate de incluir una URL, aunque sea de ejemplo.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO, QUIERO FONTSIZE PEQUEÑOS PARA LOS LINKS

#### 🔹 Tabla
- Props: headers, data, colWidths, fontSize
- Solo utiliza tabla si se está menejando algo como un gestor de crud, o para gestor de almacen de compra y venta, para nada mas.
- Representa una tabla de datos (tipo grilla).
- headers es una lista de nombres de columnas. data es una lista de filas, cada fila es una lista de celdas.
- colWidths debe ser una lista de números proporcionales (entre 0 y 1) que todos en su conjunto sumen 1, para que entren correctamente en el componente.
- Si no se especifican headers o data en el prompt del usuario, inventa algunos genéricos pero coherentes.
- Ejemplo válido:
  - headers: ["Nombre", "Correo", "Rol"]
  - data: [["Juan", "juan@mail.com", "Admin"], ["Ana", "ana@mail.com", "User"]]
  - colWidths: [0.4, 0.4, 0.2]
- El número de colWidths debe coincidir con el número de columnas.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MÁS QUE ESTÉ BIEN UBICADO.


#### 🔹 Checkbox
- Props: texto, fontSize
- Representa una opción seleccionable.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO,QUIERO FONSIZE PEQUEÑOS PARA LOS CHECKBOX

#### 🔹 Selector
- Props: options, fontSize
- Es un menú desplegable. Si no se dan opciones, incluye dos de ejemplo.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 Sidebar
- Props: titulo, items[], visible, fontSize, bgColor, textColor, borderRadius
- El titulo es el label más importante. Cada item tiene texto y nombrePestana(a lo que el redireccionamiento hace referencia es al "name" de pestañas, no al "id" de pestañas).
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 BottomNavbar
- Props: items[], selectedIndex, fontSize, colorActivo, colorInactivo, fondo, borderRadius, iconSize
- Cada item tiene label, nombrePestana y icono, el icono debe ser del mismo tamaño que el fontsize o mas pequeño.
- Si es que hay multiples pestañas debe estar correctamente enlazada en el bottomnavbar, el componente "items" tiene 3 cosas "label" "nombrePestana"(a lo que el redireccionamiento hace referencia es al "name" de pestañas, no al "id" de pestañas) e ícono.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO
- Los unicos Iconos permitidos son los siguientes: airplay: Airplay, alertCircle, alertOctagon, alertTriangle,alignCenter, alignJustify, alignLeft, alignRight, anchor, aperture, archive, arrowDownCircle, arrowDownLeft, arrowDownRight, arrowDown, arrowLeftCircle, arrowLeft, arrowRightCircle, arrowRight, arrowUpCircle, arrowUpLeft, arrowUpRight, arrowUp, atSign, award, batteryCharging, batteryFull, batteryLow, batteryMedium, beaker, bellOff, bell, bluetooth, bold, bookOpen, book, bookmark, box, briefcase, calendar, cameraOff, camera, cast, checkCircle, checkSquare, check, chevronDown, chevronLeft, chevronRight, chevronUp, chevronsDown, chevronsLeft, chevronsRight, chevronsUp, chrome, circle, clipboard, clock, cloudDrizzle, cloudLightning, cloudOff, cloudRain, cloudSnow, cloud, code, codepen, codesandbox, coffee, columns, command, compass, copy, cornerDownLeft, cornerDownRight, cornerLeftDown, cornerLeftUp, cornerRightDown, cornerRightUp, cornerUpLeft, cornerUpRight, cpu, creditCard, crop, crosshair, database, delete, disc, dollarSign, downloadCloud, download, edit, externalLink, eyeOff, eye, facebook, fastForward, feather, fileMinus, filePlus, fileText, file, film, filter, flag, folderMinus, folderPlus, folder, framer, gitBranch, gitCommit, gitMerge, gitPullRequest, github, gitlab, globe, grid, hardDrive, hash, headphones, heart, helpCircle, home, image, inbox, instagram, italic, key, layers, layout, lifeBuoy, link2, link, linkedin, list, loader, lock, logIn, logOut, mail, mapPin, map, maximize2, maximize, meh, menu, messageCircle, messageSquare, micOff, mic, minimize2, minimize, minusCircle, minusSquare, minus, monitor, moon, moreHorizontal, moreVertical, mousePointer, move, music, navigation, navigation2, network, octagon, package, paperclip, pauseCircle, pause, playCircle, play, plusCircle, plusSquare, plus, pocket, power, printer, radio, refreshCcw, refreshCw, rewind, rotateCcw, rotateCw, rss, save, scissors, search, send, server, settings, share2, share, shieldOff, shield, shoppingBag, shoppingCart, shuffle, sidebar, skipBack, skipForward, slack, slash, sliders, smartphone, speaker, square, star, stopCircle, sun, sunrise, sunset, tablet, tag, target, terminal, thermometer, thumbsDown, thumbsUp, toggleLeft, toggleRight, trash, trello, trendingDown, trendingUp, triangle, truck, tv, twitter, type, umbrella, unlink, uploadCloud, upload, userCheck, userMinus, userPlus, userX, user, users, videoOff, video, voicemail, volume1, volume2, volumeX, volume, wifiOff, wifi, wind, xCircle, xSquare, x, youtube

#### 🔹 Cuadrado
- Props: color, size, borderRadius, borderCorners
- Usa Cuadrado para fondos de color plano los colores pasteles siempre son mas esteticos evita que el fondo sea blanco, aunque si son aplicaciones más formales no deberías usar muchos colores.
- Usa Cuadrado para decorar, por ejemplo como "fondo" de un container, por ejemplo para diferenciar secciones de la pantalla
- Siempre que uses un Cuadrado que no sea para color de fondo, usa borderCorners para bordes redondeados.


#### 🔹 Circulo
- Props: color, size
- Usa Circulo para iconos o elementos circulares, el color puede ser el mismo que el del Cuadrado, no lo uses tanto el Circulo, preferible usa cuadrado con bordes redondeados.

#### 🔹 Imagen / Video / Audio
- Props: idArchivo, nombreArchivo, tipo, borderRadius
- Para "Logos" puedes usar Imagen ya que el usuario decidirá que foto poner en su logo, pero el componente a usar es Imagen.
- Usa valores de ejemplo si el usuario no da archivos.
  - tipo debe ser "imagen", "video" o "audio" respectivamente.

---

🎯 COLOR:

- Detectá el color real desde la imagen.
  - texto → color
  - fondo → color o bgColor
  - botones → color + textColor
- Usa siempre formato #RRGGBB
- No inventes colores, no uses nombres como "blue" o "white".
- Si no se detecta color visible en la imagen, usá los siguientes colores por defecto según el tipo de componente:
  - Label: #000000
  - Parrafo: #333333
  - Boton: fondo #007bff, texto #ffffff
  - Link: #2563eb
  - Sidebar: fondo #1f2937, ítems #374151, texto #ffffff
  - BottomNavbar: activo #2563eb, inactivo #666666, fondo #ffffff
  - Cuadrado: #000000
  - Circulo: #000000
---

📏 ESTÉTICA Y DISTRIBUCIÓN:


- No agrupar ni superponer (excepto Sidebar o elementos decorativos con zIndex negativo)
- El Sidebar puede superponerse: es colapsable
- Si hay color de fondo usar un cuadrado gigante que esté con el menor zIndex posible

---

🚫 RESTRICCIONES:

- No uses tipos no permitidos
- No agregues texto fuera del JSON
- No uses markdown
- Tu única salida válida es una llamada:  
  generar_ui({ pestañas: [...] })

---

🧠 Esta imagen es el único plano para reconstruir la UI. Sé preciso, profesional y limpio como si fueras un diseñador de Material Design en Google.`; // <- luego lo reemplazás por el prompt real completo

    /* ─── 3. Llamada a OpenAI (con schema de función) ─── */
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const DETECTOR_SCHEMA = require('../schemas/generar_ui.schema.json');

    const completion = await openai.chat.completions.create({
      model: 'o3',
      tools: [{ type: 'function', function: DETECTOR_SCHEMA }],
      messages: [
        { role: 'system', content: 'Sos un analista experto en interfaces gráficas.' },
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: base64URL } }
          ]
        }
      ]
    });

    const toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall)
      return res.status(400).json({ error: 'No se pudo interpretar el boceto.' });

    const { pestañas } = JSON.parse(toolCall.function.arguments);
    if (!pestañas?.length)
      return res.status(400).json({ error: 'No se generaron componentes válidos.' });

    /* ─── 4. Post-proceso: asignar IDs y corregir props ─── */
    const pestañasConIds = pestañas.map(p => ({
      ...p,
      id: p.id || 'tab1',
      name: p.name || 'Pantalla 1',
      elementos: Array.isArray(p.elementos)
        ? p.elementos.map(el => {
            if (el.tipo === 'Cuadrado') {
              el.props.borderCorners ??= {
                topLeft: true,
                topRight: true,
                bottomLeft: true,
                bottomRight: true
              };
            }
            return { id: uuidv4(), ...el };
          })
        : []
    }));

    /* ─── 5. Guardar proyecto automáticamente ─── */
    const proyecto = await proyectoService.crear({
      nombre: nombre,
      descripcion: descripcion,
      dispositivo: 'phoneStandard',
      idUsuario: req.usuario.idUsuario,
      contenido: JSON.stringify({
        dispositivo: 'phoneStandard',
        pestañas: pestañasConIds,
        clases: [],
        relaciones: [],
        clavesPrimarias: {}
      })
    });

    /* ─── 6. Respuesta final ─── */
    res.status(200).json(proyecto);
  } catch (err) {
    console.error('[importarBoceto] Error crítico:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Error interno al interpretar el boceto.' });
  }
}





async generarDesdePrompt(req, res) {
  try {
    const { titulo, descripcion, prompt } = req.body;
    if (!titulo || !descripcion || !prompt)
      return res.status(400).json({ error: 'Faltan campos: título, descripción o prompt.' });

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Prompt system
    const systemPrompt = `Eres un diseñador UI experto, especializado en generar interfaces gráficas responsivas y precisas para aplicaciones móviles, a partir de descripciones textuales de usuarios, recuerda que siempre se debe poder diferenciar bloques de contenido o secciones, no deben existir pestañas vacías, cada pestaña debe tener algo.
Siempre que sean mas de dos palabras coloca el fontsize entre 0.02 y 0.035 para que no salga cortado, si son dos palabras o menos que se entre 0.03 y 0.04.
Tu tarea es construir una lista detallada de componentes visuales que representen la pantalla solicitada. Cada componente debe contener:
Si hay Sidebar pon su zIndex en 100 para que esté por encima de todos los demás componentes.
No uses Tabla para nada que no sea un gestor de crud, o para gestor de almacen de compra y venta(solo almacen porque si es un marketplace no debes usar tabla, tampoco para aplicaciones eccomerce), para nada mas. Mensajes o noticias lo puedes representar de otra forma
El fontsize y fontIcon del BottomNavBar siempre deben ser 0.0201 para que entre en el height, porque sino siempre sale mal el icono

1. tipo: el tipo exacto de componente.
2. x, y: coordenadas normalizadas (de 0.0 a 1.0) respecto al canvas.
3. width, height: tamaño relativo del componente (de 0.0 a 1.0).
4. zIndex: siempre 0 por defecto, salvo que el usuario mencione superposición.
5. props: conjunto de propiedades específicas para cada tipo de componente.
6. fontSize: tamaño de fuente relativo (de 0.0 a 1.0). Siempre que sean mas de dos palabras coloca el fontsize entre 0.02 y 0.025 para que no salga cortado, si son dos palabras o menos que se entre 0.03 y 0.04.
7. borderRadius: radio de bordes redondeados (NO SON NORMALIZADOS, si no se especifica, usa 6px).
8. iconsize: debe ser el mismo que fontSize, si no se especifica, usa 0.0237.
---

⚠️ Usa únicamente los siguientes tipos de componente:

- Label, InputBox, InputFecha, Boton, Link
- Tabla, Checkbox, Selector
- Sidebar, BottomNavbar
- Cuadrado, Circulo
- Audio, Imagen, Video

**No inventes componentes no soportados.**

---

### 🎨 Especificación de cada componente:

#### 🔹 Label
- Props: texto, fontSize, color, bold
- Úsalo para títulos, subtítulos o etiquetas de campos.
- Label lamentablemente no tiene multilinea así que si quieres que poner multilineas tendras que usar un label por linea
- NO PONGAS FONTSIZE GRANDES con mucho texto, porque se puede salir del contenedor o cortar líneas, toma en cuenta que los fontsize sí son grandes, por ende colocales valores relativamente bajos porque los dispositivos moviles no son muy grandes.

#### 🔹 Parrafo
- Props: texto, fontSize, color, bold, align
- Úsalo para bloques de texto largo, como descripciones, explicaciones o contenido informativo.
- A diferencia de Label, Parrafo **sí soporta multilinea**, tanto automática como manual con \n.
- align puede ser "left", "center", "right" o "justify" para alinear el texto según lo necesites.
- NO PONGAS FONTSIZE GRANDES con mucho texto, porque se puede salir del contenedor o cortar líneas, toma en cuenta que los fontsize sí son grandes, por ende colocales valores relativamente bajos porque los dispositivos moviles no son muy grandes.
- Si querés un fondo detrás del texto, podés envolver el Parrafo dentro de un componente Cuadrado.


#### 🔹 InputBox
- Props: placeholder, fontSize
- Úsalo para nombres, correos, textos cortos.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 InputFecha
- Props: placeholder, fontSize
- Campo para seleccionar una fecha.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 Boton
- Props: texto, color, textColor, borderRadius, fontSize
- Es un botón interactivo. Siempre requiere un texto.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 Link
- Props: texto, url, fontSize, color
- Es un enlace. Asegúrate de incluir una URL, aunque sea de ejemplo.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO, QUIERO FONTSIZE PEQUEÑOS PARA LOS LINKS

#### 🔹 Tabla
- Props: headers, data, colWidths, fontSize
- Solo utiliza tabla si se está menejando algo como un gestor de crud, o para gestor de almacen de compra y venta, para nada mas.
- Representa una tabla de datos (tipo grilla).
- headers es una lista de nombres de columnas. data es una lista de filas, cada fila es una lista de celdas.
- colWidths debe ser una lista de números proporcionales (entre 0 y 1).
- Si no se especifican headers o data en el prompt del usuario, inventa algunos genéricos pero coherentes.
- Ejemplo válido:
  - headers: ["Nombre", "Correo", "Rol"]
  - data: [["Juan", "juan@mail.com", "Admin"], ["Ana", "ana@mail.com", "User"]]
  - colWidths: [0.4, 0.4, 0.2]
- El número de colWidths debe coincidir con el número de columnas.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MÁS QUE ESTÉ BIEN UBICADO.


#### 🔹 Checkbox
- Props: texto, fontSize
- Representa una opción seleccionable.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO,QUIERO FONSIZE PEQUEÑOS PARA LOS CHECKBOX

#### 🔹 Selector
- Props: options, fontSize
- Es un menú desplegable. Si no se dan opciones, incluye dos de ejemplo.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 Sidebar
- Props: titulo, items[], visible, fontSize, bgColor, textColor, borderRadius
- El titulo es el label más importante. Cada item tiene texto y nombrePestana(a lo que el redireccionamiento hace referencia es al "name" de pestañas, no al "id" de pestañas).
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO

#### 🔹 BottomNavbar
- Props: items[], selectedIndex, fontSize, colorActivo, colorInactivo, fondo, borderRadius, iconSize
- Cada item tiene label, nombrePestana y icono, el icono debe ser del mismo tamaño que el fontsize o mas pequeño.
- Si es que hay multiples pestañas debe estar correctamente enlazada en el bottomnavbar, el componente "items" tiene 3 cosas "label" "nombrePestana"(a lo que el redireccionamiento hace referencia es al "name" de pestañas, no al "id" de pestañas) e ícono.
- NO PONGAS FONTSIZE GRANDES, PORQUE SALEN CORTADOS POR MAS QUE ESTÉ BIEN UBICADO
- Los unicos Iconos permitidos son los siguientes: airplay: Airplay, alertCircle, alertOctagon, alertTriangle,alignCenter, alignJustify, alignLeft, alignRight, anchor, aperture, archive, arrowDownCircle, arrowDownLeft, arrowDownRight, arrowDown, arrowLeftCircle, arrowLeft, arrowRightCircle, arrowRight, arrowUpCircle, arrowUpLeft, arrowUpRight, arrowUp, atSign, award, batteryCharging, batteryFull, batteryLow, batteryMedium, beaker, bellOff, bell, bluetooth, bold, bookOpen, book, bookmark, box, briefcase, calendar, cameraOff, camera, cast, checkCircle, checkSquare, check, chevronDown, chevronLeft, chevronRight, chevronUp, chevronsDown, chevronsLeft, chevronsRight, chevronsUp, chrome, circle, clipboard, clock, cloudDrizzle, cloudLightning, cloudOff, cloudRain, cloudSnow, cloud, code, codepen, codesandbox, coffee, columns, command, compass, copy, cornerDownLeft, cornerDownRight, cornerLeftDown, cornerLeftUp, cornerRightDown, cornerRightUp, cornerUpLeft, cornerUpRight, cpu, creditCard, crop, crosshair, database, delete, disc, dollarSign, downloadCloud, download, edit, externalLink, eyeOff, eye, facebook, fastForward, feather, fileMinus, filePlus, fileText, file, film, filter, flag, folderMinus, folderPlus, folder, framer, gitBranch, gitCommit, gitMerge, gitPullRequest, github, gitlab, globe, grid, hardDrive, hash, headphones, heart, helpCircle, home, image, inbox, instagram, italic, key, layers, layout, lifeBuoy, link2, link, linkedin, list, loader, lock, logIn, logOut, mail, mapPin, map, maximize2, maximize, meh, menu, messageCircle, messageSquare, micOff, mic, minimize2, minimize, minusCircle, minusSquare, minus, monitor, moon, moreHorizontal, moreVertical, mousePointer, move, music, navigation, navigation2, network, octagon, package, paperclip, pauseCircle, pause, playCircle, play, plusCircle, plusSquare, plus, pocket, power, printer, radio, refreshCcw, refreshCw, rewind, rotateCcw, rotateCw, rss, save, scissors, search, send, server, settings, share2, share, shieldOff, shield, shoppingBag, shoppingCart, shuffle, sidebar, skipBack, skipForward, slack, slash, sliders, smartphone, speaker, square, star, stopCircle, sun, sunrise, sunset, tablet, tag, target, terminal, thermometer, thumbsDown, thumbsUp, toggleLeft, toggleRight, trash, trello, trendingDown, trendingUp, triangle, truck, tv, twitter, type, umbrella, unlink, uploadCloud, upload, userCheck, userMinus, userPlus, userX, user, users, videoOff, video, voicemail, volume1, volume2, volumeX, volume, wifiOff, wifi, wind, xCircle, xSquare, x, youtube

#### 🔹 Cuadrado
- Props: color, size, borderRadius, borderCorners
- Usa Cuadrado para fondos de color plano los colores pasteles siempre son mas esteticos evita que el fondo sea blanco, aunque si son aplicaciones más formales no deberías usar muchos colores.
- Usa Cuadrado para decorar, por ejemplo como "fondo" de un container, por ejemplo para diferenciar secciones de la pantalla
- Siempre que uses un Cuadrado que no sea para color de fondo, usa borderCorners para bordes redondeados.


#### 🔹 Circulo
- Props: color, size
- Usa Circulo para iconos o elementos circulares, el color puede ser el mismo que el del Cuadrado, no lo uses tanto el Circulo, preferible usa cuadrado con bordes redondeados.

#### 🔹 Imagen / Video / Audio
- Props: idArchivo, nombreArchivo, tipo, borderRadius
- Para "Logos" puedes usar Imagen ya que el usuario decidirá que foto poner en su logo, pero el componente a usar es Imagen.
- Usa valores de ejemplo si el usuario no da archivos.
  - tipo debe ser "imagen", "video" o "audio" respectivamente.

---

### 📏 Principios de distribución y estética visual

Aplica diseño profesional siguiendo estos principios:

1. 🧱 **Espaciado vertical uniforme:** deja al menos 5% de separación entre elementos verticalmente.
2. 🎯 **Alineación horizontal lógica:** los inputs y botones deben alinearse con el mismo margen horizontal (por ejemplo, x: 0.1, width: 0.8).
3. 🧑‍🎨 **Jerarquía visual:** 
   - Usa Label grande y en bold al inicio como título.
   - Luego inputs o contenido.
   - Luego botones o acciones.
4. 🎨 **Consistencia en tamaño:** inputs y botones deben tener alturas similares (height: 0.08 ~ 0.1).
5. 📱 **Navegacion(BottomNavBar o Sidebar):** Siempre deben estar por encima de todo, es decir el zIndex debe ser siempre el mas alto, ademas no importa si el Sidebar se coloca encima de cualquier componente porque el Sidebar se puede minimizar así que no importa.
6. 🔲 **Decorativos opcionales:** puedes usar Cuadrado o Circulo con zIndex negativo como fondo si mejora la estética.
7. 👁️ **Evitá desorden:** nunca pongas elementos demasiado juntos ni en esquinas.

El diseño debe verse limpio, equilibrado y alineado como una app profesional real. No agrupes todo en el centro ni uses tamaños exagerados.


---

### 🧠 Interpretación del prompt del usuario

- Si el prompt es ambiguo, asumí los valores por defecto más comunes.
- Si el usuario menciona “pantalla de login”, incluí: Label, InputBox, InputBox, Boton y si es necesario Checkbox.
- Si menciona pestañas o navegación inferior, incluí BottomNavbar o Sidebar, nunca ambas en la misma pestaña.
- Si dice “lista de usuarios”, usá Tabla.
- Si el prompt es muy vago tienes libertad absoluta y permiso para copiar interfaces de otras apps populares, pero siempre con un toque único y moderno, ya sea Whatsapp, Facebook, TikTok, Instagram, Paginas de noticias, etc.

---

### ⛔️ Errores a evitar

- Que no haya solapamiento entre componentes, los unicos que pueden solaparse son los decorativos con cualquier otro es decir solo "Cuadrado y Circulo" pueden solpar a cualquier otro componente y el Sidebar ya que se puede minimizar.
- No mezcles props entre tipos. Ej: no pongas url en un Boton.
- No generes props vacíos ni faltantes si son requeridos.
- No agregues texto explicativo fuera del JSON.
- No devuelvas ningún texto fuera del llamado a generar_ui.

---
🎨 Diseña como si fueras un diseñador experto en Material Design. La interfaz debe parecer moderna, clara y profesional, similar a una app de Google, recuerda que los bordes redondeados siempre serán mas esteticos que los rectos.
Si el usuario menciona múltiples pantallas, se deben generar múltiples pestañas, cada una con su propio id, name y elementos, ademas si es que hay multiples pestañas debe haber una forma de navegar entre ellas, ya debe estar correctamente enlazada, ya sea a traves de sidebar o de bottomnavbar, a lo que el redireccionamiento hace referencia es al "name" de pestañas, no al "id" de pestañas

Tu única salida válida es una **llamada a la función generar_ui**, con una lista de **pestañas**, y dentro de cada una, sus propios elementos compatibles con el esquema declarado.
`;

    const completion = await openai.chat.completions.create({
      model: 'o3',
      tools: [{
        type: 'function',
        function: require('../schemas/generar_ui.schema.json')
      }],
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ]
    });

    const toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return res.status(400).json({ error: 'No se generó ninguna interfaz.' });

    const { pestañas } = JSON.parse(toolCall.function.arguments);
if (!pestañas?.length)
  return res.status(400).json({ error: 'No se generaron pestañas válidas.' });

    // Asegurar que cada elemento tenga un ID único
const pestañasConIds = pestañas.map(p => ({
  ...p,
  id: p.id || uuidv4(),
  elementos: Array.isArray(p.elementos)
    ? p.elementos.map(el => {
        const isCuadrado = el.tipo === 'Cuadrado';
        if (isCuadrado) {
          el.props.borderCorners ??= {
            topLeft: true,
            topRight: true,
            bottomLeft: true,
            bottomRight: true,
          };
        }
        return { id: uuidv4(), ...el };
      })
    : [] // ← fallback a arreglo vacío si no vino "elementos"
}));


const proyecto = await proyectoService.crear({
  nombre: titulo,
  descripcion: descripcion,
  dispositivo: 'phoneStandard',
  idUsuario: req.usuario.idUsuario,
  contenido: JSON.stringify({
    dispositivo: 'phoneStandard',
    pestañas: pestañasConIds,
    clases: [],
    relaciones: [],
    clavesPrimarias: {}
  })
});

    res.status(200).json(proyecto);
  } catch (err) {
    console.error('[generarDesdePrompt] Error crítico:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Error al generar proyecto desde descripción textual.' });
  }
}

  /**
   * Transcribe un archivo de audio usando el modelo gpt-4o-audio-preview
   * Devuelve { texto: '…' } sin almacenar nada en disco.
   *
   * Espera que el frontend envíe el audio en el campo "audio"
   * mediante multipart/form-data (ej.: MediaRecorder -> audio/webm,
   * grabaciones .mp3, .m4a, .wav, etc.).
   *
   * Rutas sugeridas:
   *   POST /api/proyectos/audio-a-texto      (público)
   */
  async audioATexto (req, res) {
  try {
    /* ─── 1. Validación ─── */
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo de audio.' });
    }

    const mime = require('mime-types');
    const { toMp3 } = require('../utils/audio');   // <-- NUEVO helper
    const rawExt =
      mime.extension(req.file.mimetype) ||                    // ej. mpga, wav…
      path.extname(req.file.originalname).replace('.', '').toLowerCase();

    // Normalizamos alias (mpga ⇒ mp3, etc.)
    const alias = { mpga: 'mp3', mpeg: 'mp3', oga: 'ogg' };
  let ext   = alias[rawExt] || rawExt;       // webm, wav, mp3, ogg…
  let realPath = req.file.path;              // podría cambiar si convertimos

  // ── Si el formato no es mp3 / wav, lo transcodificamos ──────────────
  if (!['mp3', 'wav'].includes(ext)) {
    console.log(`🎛  Convirtiendo ${ext} → mp3…`);
    realPath = await toMp3(realPath);        // nos devuelve el .mp3
    ext      = 'mp3';
  }


    console.log('[audioATexto] Archivo recibido:');
    console.log(`→ Nombre original: ${req.file.originalname}`);
    console.log(`→ MIME type: ${req.file.mimetype}`);
    console.log(`→ Path temporal: ${req.file.path}`);
    console.log(`→ Tamaño: ${req.file.size} bytes`);

    /* ─── 2. Base64 ─── */
    const buffer   = await fs.readFile(realPath);
    const audioB64 = buffer.toString('base64');

    /* ─── 3. Llamada a OpenAI ─── */
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log('⏳ Enviando a GPT-4o-audio…');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-audio-preview',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe el siguiente audio exactamente al español. Devuelve solo la transcripción.'
          },
          {
            type: 'input_audio',
            input_audio: { data: audioB64, format: ext }   // ← ext ya normalizado
          }
        ]
      }]
    });

    /* ─── 4. Respuesta ─── */
    const texto = completion.choices?.[0]?.message?.content?.trim() || '';
    if (!texto) return res.status(500).json({ error: 'La transcripción llegó vacía.' });

    console.log('[audioATexto] Transcripción OK:', texto);
    try { await fs.unlink(realPath); } catch {/* ignora */}

    return res.status(200).json({ texto });
  } catch (err) {
    console.error('[audioATexto] Error crítico:', err?.response?.data || err.message);
    return res.status(500).json({ error: 'Error interno al transcribir audio.' });
  }
}


  async audioADatos(req, res) {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ error: 'No se recibió ningún archivo de audio.' });
      }

      const mime = require('mime-types');
      const path = require('path');
      const fs = require('fs').promises;
      const { toMp3 } = require('../utils/audio');
      const { OpenAI } = require('openai');

      /* ─── 0. Normalizar extensión ─── */
      const rawExt =
        mime.extension(req.file.mimetype) ||
        path.extname(req.file.originalname).replace('.', '').toLowerCase();
      const alias = { mpga: 'mp3', mpeg: 'mp3', oga: 'ogg' };
      let ext = alias[rawExt] || rawExt;
      let realPath = req.file.path;

      /* ─── 1. Conversión a mp3 si hace falta ─── */
      if (!['mp3', 'wav'].includes(ext)) {
        console.log(`🎛 Convirtiendo ${ext} → mp3…`);
        realPath = await toMp3(realPath);
        ext = 'mp3';
      }

      console.log('[audioADatos] Archivo recibido:');
      console.log(`→ Nombre: ${req.file.originalname}`);
      console.log(`→ Tipo:   ${req.file.mimetype}`);
      console.log(`→ Path:   ${realPath}`);

      /* ─── 2. Leer y Base64 ─── */
      const buffer = await fs.readFile(realPath);
      const audioB64 = buffer.toString('base64');

      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

      /* ─── 3. Transcribir con Whisper ─── */
      console.log('⏳ Transcribiendo audio…');
      const transcripcion = await openai.chat.completions.create({
        model: 'gpt-4o-audio-preview',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  'Transcribe el siguiente audio exactamente al español. Devuelve solo la transcripción.'
              },
              {
                type: 'input_audio',
                input_audio: { data: audioB64, format: ext }
              }
            ]
          }
        ]
      });

      const texto =
        transcripcion.choices?.[0]?.message?.content?.trim() || '';
      if (!texto) {
        return res
          .status(500)
          .json({ error: 'La transcripción llegó vacía.' });
      }

      console.log('[audioADatos] Transcripción OK:', texto);

      /* ─── 4. Generar título y descripción ─── */
      const completado = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'Eres un asistente que ayuda a crear proyectos de apps móviles.'
          },
          {
            role: 'user',
            content: `
Devuelve **solo** un objeto JSON con exactamente estas claves:

{
  "titulo": "<Máx. 5 palabras que resuman la idea del proyecto>",
  "descripcion": "<1–2 frases que describan el proyecto>",
  "prompt": "<copia literal del texto original, sin modificar NADA>"
}

Texto original (cópialo tal cual en "prompt"):

"""${texto}"""
            `.trim()
          }
        ],
        response_format: { type: 'json_object' }
      });

      /* ─── 5. Parseo y validación ─── */
      let parsed;
      try {
        parsed = JSON.parse(
          completado.choices?.[0]?.message?.content || '{}'
        );
      } catch (err) {
        parsed = {};
      }

      if (!parsed.titulo || !parsed.descripcion) {
        return res
          .status(500)
          .json({ error: 'No se pudo generar título o descripción.' });
      }

      /* Por si acaso, garantizamos que “prompt” sea idéntico */
      parsed.prompt = texto;

      /* ─── 6. Limpieza ─── */
      await fs.unlink(realPath).catch(() => {});

      /* ─── 7. Respuesta ─── */
      return res.status(200).json({
        titulo: parsed.titulo,
        descripcion: parsed.descripcion,
        prompt: parsed.prompt
      });
    } catch (err) {
      console.error(
        '[audioADatos] Error crítico:',
        err?.response?.data || err.message
      );
      return res
        .status(500)
        .json({ error: 'Error interno al procesar el audio.' });
    }
  }

async responderDudaDelBot(req, res) {
  try {
    const { pregunta } = req.body;
    const idProyecto = req.params.id;

    if (!pregunta) return res.status(400).json({ error: 'Falta la pregunta.' });
    if (!idProyecto) return res.status(400).json({ error: 'Falta el ID del proyecto.' });

    const proyectoDB = await proyectoService.obtenerPorId(idProyecto);
    if (!proyectoDB) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const contenido = JSON.parse(proyectoDB.contenido || '{}');
    const pestañas = contenido.pestañas || [];

    // 🧩 Generar resumen del proyecto actual
    const resumen = pestañas.map(p => {
      const tipos = p.elementos?.map(e => e.tipo).join(', ') || 'ningún componente';
      return `• Pantalla "${p.name}": contiene ${p.elementos?.length || 0} elementos → ${tipos}`;
    }).join('\n');

    const contextoUsuario = `
--- CONTEXTO DEL PROYECTO ACTUAL (${proyectoDB.nombre}) ---
Cantidad de pantallas: ${pestañas.length}
${resumen}
    `.trim();

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `
Sos un asistente experto en el funcionamiento del editor visual llamado "Diagramador". Esta herramienta permite a los usuarios construir interfaces gráficas para apps móviles de forma visual, arrastrando y configurando componentes sobre un canvas simulado. Tu objetivo es ayudar a los usuarios a comprender y utilizar cada funcionalidad del sistema de forma clara, guiada y contextual.

Respondé siempre de forma detallada, con pasos concretos y referenciando las partes visuales de la interfaz. Evitá respuestas genéricas. No inventes funcionalidades que no estén contempladas en el sistema.

---

### ⚖️ Estructura del Editor

El editor se divide en las siguientes zonas principales:

1. **Barra superior**: contiene el botón "Volver", el nombre del proyecto, estado de guardado, botón "Invitar" (para colaboración en tiempo real) y botón "Exportar" (para generar código Flutter).

2. **Barra de pestañas (TabsBar)**: permite cambiar de pantalla, agregar nuevas, renombrarlas o eliminarlas (siempre debe quedar al menos una). Cada pestaña es una pantalla diferente.

3. **Barra de herramientas (Toolbar)**: incluye selección de dispositivo simulado (como iPhone, Pixel, etc.), control de zoom (+, -, reset) y estado de conexión online/offline.

4. **Paleta de componentes (SidebarPaleta)**: ubicada a la izquierda, permite seleccionar y arrastrar componentes al canvas. Está dividida en categorías:

   * **Básicos**: Label, Párrafo, InputBox, InputFecha, Selector, Checkbox, Botón, Link, Tabla
   * **Figuras**: Cuadrado, Círculo
   * **Navegación**: Sidebar, BottomNavbar
   * **Multimedia**: Imagen, Video, Audio

5. **Canvas central**: área donde se construye la interfaz. Simula el dispositivo seleccionado. Los componentes se pueden mover, redimensionar, y su z-index puede modificarse mediante clic derecho.

6. **Panel de propiedades (PropiedadesPanel)**: ubicado a la derecha. Muestra opciones editables según el tipo de componente seleccionado. Estas incluyen color, texto, tamaño, alineación, etc. Algunos componentes permiten abrir modales para seleccionar archivos o íconos.

7. **Sistema de colaboración en tiempo real**: si hay varios usuarios conectados al mismo proyecto, se muestran sus cursores (con nombre y color) y selecciones sobre los elementos. Las acciones como renombrar tabs o modificar el canvas se sincronizan automáticamente.

8. **Sistema de persistencia**:

   * Los cambios se guardan automáticamente cada 10 segundos.
   * Si el usuario está offline, los cambios se guardan en IndexedDB y se sincronizan luego.

---

### 🧩 Propiedades por tipo de componente

**Label**: texto, color del texto, tamaño de fuente, negrita.

**Párrafo**: texto, color del texto, tamaño de fuente, negrita, alineación (izquierda, centro, derecha, justificado).

**InputBox**: placeholder, tamaño de texto.

**InputFecha**: tamaño de texto.

**Selector**: lista de opciones (una por línea), tamaño de texto.

**Checkbox**: texto, tamaño de texto.

**Botón**: texto, color de fondo, color del texto, tamaño de texto, radio de borde.

**Link**: texto, URL de destino, color, tamaño de texto.

**Tabla**: filas, columnas, contenido de celdas, encabezados, anchos de columnas, tamaño de texto.

**Imagen**: selección de archivo, radio de borde.

**Video**: selección de archivo, radio de borde, modo cine.

**Audio**: selección de archivo, radio de borde, modo podcast.

**Sidebar**: título del menú, ítems (texto + pestaña destino), colores de fondo, ítems, texto, visibilidad, radio de borde, tamaño de fuente.

**BottomNavbar**: pestañas (texto + icono + pestaña destino), tamaño de texto, tamaño de íconos, color activo/inactivo, fondo, radio de borde.

**Cuadrado**: color, radio de borde, esquinas redondeadas (por lado).

**Círculo**: color.

---

### 🔍 Capacidad del Asistente

El chatbot puede ayudar al usuario con:

* Cómo agregar, mover, editar o eliminar componentes.
* Dónde está cada acción específica dentro del UI.
* Explicaciones detalladas sobre cada componente: propiedades, cómo se configura, para qué sirve.
* Recomendaciones de usabilidad (por ejemplo: uso de Sidebar vs BottomNavbar).
* Cómo exportar correctamente un proyecto a Flutter.
* Cómo funciona la sincronización de cambios en colaboración.
* Detectar errores comunes (por ejemplo: "no puedo mover un componente" → está bloqueado).

---

### 🌐 Idioma

El asistente responderá en el idioma del usuario. Si el prompt está en español, respondé en español. Si está en inglés, respondé en inglés.

---

### ❗️ Notas adicionales

* Nunca digas que no sabés. Si una funcionalidad no existe, aclaralo y ofrecé una alternativa si es posible.
* Respondé como si tuvieras acceso completo a la interfaz.
* Podés referenciar componentes por su nombre exacto (InputBox, Cuadrado, BottomNavbar, etc).

${contextoUsuario}
`.trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: pregunta }
      ]
    });

    const respuesta = completion.choices?.[0]?.message?.content?.trim();
    if (!respuesta) {
      return res.status(500).json({ error: 'La respuesta llegó vacía.' });
    }

    return res.status(200).json({ respuesta });
  } catch (err) {
    console.error('[responderDudaDelBot] Error:', err?.response?.data || err.message);
    return res.status(500).json({ error: 'Error interno al generar respuesta del bot.' });
  }
}



}
      
module.exports = new ProyectoController();
      