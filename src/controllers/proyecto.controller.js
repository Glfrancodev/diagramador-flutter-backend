const fs = require('fs').promises;
const { OpenAI } = require('openai');
const axios = require('axios');
const fsSync = require('fs'); // <- nuevo alias para funciones síncronas como readFileSync
const fsExtra = require('fs-extra');
const archiver = require('archiver');
const path = require('path');
const { createWriteStream, rmSync, unlinkSync } = require('fs');
const proyectoService = require('../services/proyecto.service');
const crypto = require('crypto');
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
      return {
        clase: `Pantalla${camel}`,
        file : `pantalla_${limpio.toLowerCase().replace(/\s+/g, '')}.dart`,
        ruta : `/${camel}`,
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
  const width = el.width || 1;  // Usar el tamaño completo del contenedor
  const height = el.height || 1; // Usar el tamaño completo del contenedor
  const color = el.props?.color || '#000000';  // Obtener color, si no, usar negro por defecto
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
        width: width * MediaQuery.of(context).size.width,  // Escala con el tamaño de la pantalla
        height: height * MediaQuery.of(context).size.height, // Escala con el tamaño de la pantalla
        decoration: BoxDecoration(
          color: color,  // Directamente el color ya convertido
          shape: BoxShape.rectangle,
        ),
      );
    }
  }
  `);

  // Serialización segura para Dart
  const dartColor = color.replace('#', '');  // Quitar '#' para el formato hexadecimal
  return posWrap(`_${id}(
    width: ${width},
    height: ${height},
    color: Color(0xFF${dartColor}),  // Pasar el color como objeto Color
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
    /* ─── 0. Validaciones ─── */
    if (!req.file)
      return res.status(400).json({ error: 'No se recibió ninguna imagen.' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!['.png', '.jpg', '.jpeg'].includes(ext))
      return res.status(400).json({ error: 'Formato no válido. Solo PNG o JPG.' });

    /* ─── 1. Imagen → base64 ─── */
    const rutaImg = req.file.path;
    const buffer  = await fs.readFile(rutaImg);
    const { width: W, height: H } = sizeOf(buffer);
    const base64URL =
      `data:image/${ext.replace('.', '')};base64,${buffer.toString('base64')}`;

    /* ─── 2. Prompt ─── */
const prompt = `
Eres un analista experto en mockups de interfaces, es decir, necesito que sepas describir de manera exacta y fiel el contenido de la imagen que te voy a mandar haciendo que tu respuesta sea completamente fiel al boceto de imagen.

INSTRUCCIONES GENERALES
• Usa TODO el marco de la imagen como canvas (sin márgenes).
• Devuelve CADA componente visible (Label, InputBox, InputFecha, Boton, Sidebar, etc.).
• Las coordenadas bb.x, bb.y, bb.w, bb.h deben estar en **píxeles absolutos**
  respecto al tamaño real de la imagen (${W}px × ${H}px).
• Si un Selector está desplegado (con varias opciones visibles), incluye esas opciones en props.options[].
• Si sólo una opción es visible incluye esa opción en props.options[].
SIDEBARS
• Si un Label cae completamente DENTRO del rectángulo del Sidebar:
  - El Label más alto será props.titulo.
  - El resto irán en props.items[].
• No devuelvas esos Label como elementos sueltos fuera del Sidebar.
SELECTOR DESPLEGADO
• Si detectas una caja con una opción visible y debajo aparecen una o más líneas de texto alineadas verticalmente, dentro de rectángulos del mismo ancho:
  - Interprétalo como un Selector desplegado.
  - Usa la opción visible como props.texto
  - Incluye TODAS las opciones visibles, incluyendo la seleccionada, en props.options[].
  - Usa las opciones listadas debajo como props.options[]
• No trates esas opciones como tabla ni como input.

FORMATO DE SALIDA
• Llama únicamente a la función detect_ui con el JSON correspondiente.
• No añadas ningún texto adicional fuera del JSON.
`;

    /* ─── 3. Llamada a OpenAI (reintento) ─── */
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    let toolCall;
    for (let i = 0; i < 2; i++) {
      const completion = await openai.chat.completions.create({
        model: 'o3',
        tools: [{ type: 'function', function: DETECTOR_SCHEMA }],
        messages: [
          { role: 'system', content: 'Eres un analista experto en wireframes.' },
          { role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: base64URL } }
          ] }
        ],
        max_completion_tokens: 2048
      });
      toolCall = completion.choices?.[0]?.message?.tool_calls?.[0];
      if (toolCall) break;
    }
    if (!toolCall)
      return res.status(400).json({ error: 'No se pudo interpretar el boceto.' });

    /* ─── 4. Parseo bruto ─── */
    let { boxes } = JSON.parse(toolCall.function.arguments);
    if (!boxes?.length)
      return res.status(400).json({ error: 'No se detectaron componentes.' });

    /* ─── 5. Post-proceso de Sidebar ─── */
    for (const sb of boxes.filter(b => b.tipo === 'Sidebar')) {
      const sx = sb.bb.x, sy = sb.bb.y,
            sx2 = sx + sb.bb.w, sy2 = sy + sb.bb.h;

      const internos = boxes.filter(b =>
        b.tipo === 'Label' &&
        b.bb.x >= sx && (b.bb.x + b.bb.w) <= sx2 &&
        b.bb.y >= sy && (b.bb.y + b.bb.h) <= sy2
      );

      if (internos.length) {
        internos.sort((a, b) => a.bb.y - b.bb.y);
        const tituloLbl = internos.shift();
        sb.titulo = tituloLbl.texto.trim();
        sb.items  = internos.map(l => ({ texto: l.texto.trim() }));
        // eliminar labels absorbidos
        boxes = boxes.filter(b => !internos.includes(b) && b !== tituloLbl);
      } else if (sb.texto) {
        // Fallback: usar texto del propio objeto Sidebar
        sb.titulo = sb.texto.trim();
      }
    }

    /* ─── 6. Boxes → elementos canvas ─── */
    const elementos = boxes.map(b => {
      const x = +(b.bb.x / W).toFixed(6);
      const y = +(b.bb.y / H).toFixed(6);
      const width  = +(b.bb.w / W).toFixed(6);
      const height = +(b.bb.h / H).toFixed(6);

      const base = {
        id: uuidv4(),
        tipo: b.tipo,
        x, y, width, height,
        props: { fontSize: estimateFontSize(b.bb.h) }

      };

      switch (b.tipo) {
        case 'Label':
          Object.assign(base.props, { texto: b.texto || '', color: '#000000', bold: false });
          break;
        case 'InputBox':
        case 'InputFecha':
          base.props.placeholder = b.texto || '';
          break;
        case 'Boton':
          Object.assign(base.props, {
            texto: b.texto || 'Botón',
            color: '#007bff',
            textColor: '#ffffff',
            borderRadius: 4
          });
          break;
        case 'Checkbox':
          base.props.texto = b.texto || 'Opción';
          break;
        case 'Selector':
          base.props.options = b.options || ['Opción 1', 'Opción 2'];
          break;
        case 'Tabla':
          Object.assign(base.props, {
            headers: b.headers || [],
            data: b.filas || [],
            colWidths: (b.headers || []).map(() => 100)
          });
          break;
        case 'Link':
          Object.assign(base.props, {
            texto: b.texto || 'Ir',
            url: b.url || 'https://ejemplo.com',
            color: '#2563eb'
          });
          break;
        case 'Sidebar':
          Object.assign(base.props, {
            titulo : b.titulo || '(SIN_TÍTULO)',
            items  : (b.items || []).map(it => ({
              texto: it.texto,
              nombrePestana: 'Pantalla 1'
            })),
            visible: true
          });
          break;
      }
      return base;
    });
    // Guardar automáticamente al detectar boceto
    await proyectoService.crear({
      nombre: 'Nuevo proyecto desde boceto',
      dispositivo: 'phoneStandard',
      idUsuario: req.usuario.idUsuario,
      contenido: JSON.stringify({
        dispositivo: 'phoneStandard',
        pestañas: [{ id: 'tab1', name: 'Pantalla 1', elementos }],
        clases: [],
        relaciones: [],
        clavesPrimarias: {}
      })
    });

    /* ─── 7. Respuesta ─── */
    res.status(200).json({
      dispositivo: 'phoneStandard',
      pestañas: [{ id: 'tab1', name: 'Pantalla 1', elementos }],
      clases: [],
      relaciones: [],
      clavesPrimarias: {},
      raw: toolCall.function.arguments
    });

  } catch (err) {
    console.error('[importarBoceto] Error crítico:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Error interno al analizar el boceto.' });
  }
}
}
      
module.exports = new ProyectoController();
      