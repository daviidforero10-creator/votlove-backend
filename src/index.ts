import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { pool } from "./db";
import { v4 as uuidv4 } from "uuid";
import * as QRCode from "qrcode";
import PDFDocument = require("pdfkit");
import multer from "multer";
import path from "path";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

// =====================================
// 🌐 CONFIG
// =====================================

const BASE_URL = "https://votlove-backend.onrender.com"
const FRONT_URL = "https://votlove-app.web.app"

// =====================================
// 🧪 TEST DB
// =====================================

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows);
  } catch (error) {
    console.error("❌ ERROR DB:", error);
    res.status(500).json({ error: "Error DB" });
  }
});

// =====================================
// 📁 SUBIDA DE IMÁGENES
// =====================================

const storage = multer.diskStorage({
  destination: "src/uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

app.use("/uploads", express.static("src/uploads"));

app.post("/upload", upload.single("file"), (req, res) => {
  try {
    const file = (req as any).file;

    if (!file) {
      return res.status(400).json({ error: "No se subió archivo" });
    }

    const url = `${BASE_URL}/uploads/${file.filename}`;
    res.json({ url });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error subiendo imagen" });
  }
});

// =====================================
// 🚀 BASE
// =====================================

app.get("/", (req, res) => {
  res.send("🚀 VotLove Backend funcionando");
});

// =====================================
// 🗑 ELIMINAR VOTACIÓN
// =====================================

app.delete("/votaciones/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`
      DELETE FROM votos 
      WHERE candidato_id IN (
        SELECT id FROM candidatos WHERE votacion_id=$1
      )
    `, [id]);

    await pool.query(
      "DELETE FROM candidatos WHERE votacion_id=$1",
      [id]
    );

    await pool.query(
      "DELETE FROM votaciones WHERE id=$1",
      [id]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error eliminando votación" });
  }
});

// =====================================
// 🧑 VOTANTES
// =====================================

app.post("/crear-votante", async (req, res) => {
  try {
    const { nombre, identificacion } = req.body;

    if (!nombre || !identificacion) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const qr_token = uuidv4();

    const result = await pool.query(
      `INSERT INTO votantes (nombre, identificacion, qr_token)
       VALUES ($1, $2, $3) RETURNING *`,
      [nombre, identificacion, qr_token]
    );

    res.json(result.rows[0]);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creando votante" });
  }
});

app.get("/votantes", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM votantes");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Error obteniendo votantes" });
  }
});

// =====================================
// 🗑 ELIMINAR VOTANTE (🔥 FIX)
// =====================================

app.delete("/votantes/:id", async (req, res) => {
  try {
    const { id } = req.params;

    console.log("🗑️ Eliminando votante:", id);

    const result = await pool.query(
      "DELETE FROM votantes WHERE id = $1 RETURNING *",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Votante no encontrado" });
    }

    res.json({ ok: true, mensaje: "Votante eliminado" });

  } catch (error) {
    console.error("❌ Error eliminando votante:", error);
    res.status(500).json({ error: "Error eliminando votante" });
  }
});

// =====================================
// 📋 LISTAR VOTACIONES
// =====================================

app.get("/votaciones", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM votaciones ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error obteniendo votaciones" });
  }
});

// =====================================
// 🗳 CREAR VOTACIÓN
// =====================================

app.post("/votaciones", async (req, res) => {
  console.log("🔥 BODY COMPLETO:", req.body);

  try {
    const { nombre, candidatos, max_votantes } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: "Nombre requerido" });
    }

    if (!candidatos || candidatos.length === 0) {
      return res.status(400).json({
        error: "Debe agregar al menos un candidato",
      });
    }

    const result = await pool.query(
      "INSERT INTO votaciones (nombre, estado, max_votantes) VALUES ($1,'inactiva',$2) RETURNING *",
      [nombre, max_votantes || 0]
    );

    const votacion = result.rows[0];

    for (let c of candidatos) {
      if (!c.nombre) continue;

      // 🔒 VALIDACIÓN AGREGADA
      if (!c.foto || c.foto.trim() === "") {
        return res.status(400).json({
          error: `El candidato "${c.nombre}" no tiene foto`
        });
      }

      await pool.query(
        "INSERT INTO candidatos (nombre, votacion_id, foto) VALUES ($1,$2,$3)",
        [c.nombre, votacion.id, c.foto || null]
      );
    }

    // ✅ VOTO EN BLANCO (AGREGADO SIN TOCAR NADA)
await pool.query(
  "INSERT INTO candidatos (nombre, votacion_id, foto) VALUES ($1,$2,$3)",
  ["Voto en blanco", votacion.id, ""]
);

    res.json(votacion);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creando votación" });
  }
});



console.log("🔥 BACKEND NUEVO ACTIVO 🔥");
console.log("FRONT_URL:", FRONT_URL);


// =====================================
// 🟢 ACTIVAR / DESACTIVAR / CERRAR
// =====================================

app.put("/votaciones/activar/:id", async (req, res) => {
  const multipleActiva = await pool.query(
    `SELECT * FROM votaciones_multiples
     WHERE estado = 'activa'
     LIMIT 1`
  );

  if (multipleActiva.rows.length > 0) {
    return res.json({
      ok: false,
      error: "Hay una votación múltiple activa. Debe cerrarla o desactivarla primero."
    });
  }

  await pool.query("UPDATE votaciones SET estado='inactiva'");
  await pool.query("UPDATE votaciones SET estado='activa' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.put("/votaciones/desactivar/:id", async (req, res) => {
  await pool.query("UPDATE votaciones SET estado='inactiva' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

app.put("/votaciones/cerrar/:id", async (req, res) => {
  await pool.query("UPDATE votaciones SET estado='cerrada' WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// =====================================
// 🟢 VOTACIÓN ACTIVA
// =====================================

app.get("/votacion-activa", async (req, res) => {
  const votacion = await pool.query(
    "SELECT * FROM votaciones WHERE estado='activa' LIMIT 1"
  );

  if (votacion.rows.length === 0) {
    return res.json({ votacion: null });
  }

  const candidatos = await pool.query(
    "SELECT * FROM candidatos WHERE votacion_id=$1",
    [votacion.rows[0].id]
  );

  res.json({
    votacion: votacion.rows[0],
    candidatos: candidatos.rows,
  });
});

// =====================================
// 🔳 QR
// =====================================

app.get("/qr/:token", async (req, res) => {
  const url = `https://google.com`;
  const qr = await QRCode.toBuffer(url);
  res.setHeader("Content-Type", "image/png");
  res.send(qr);
});

// =====================================
// 📄 PDF
// =====================================

app.get("/pdf-votantes", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM votantes");

    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
    });

    // ✅ HEADERS CORRECTOS (CLAVE)
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=votantes.pdf");

    doc.pipe(res);

    for (let i = 0; i < result.rows.length; i++) {
      const v = result.rows[i];

      const url = `${process.env.FRONT_URL}/#/votar/${v.qr_token}`;
      const qr = await QRCode.toBuffer(url);

      // 🧾 Título
      doc.fontSize(18).text("TARJETA DE VOTACIÓN", {
        align: "center",
      });

      doc.moveDown();

      // 👤 Nombre
      doc.fontSize(14).text(v.nombre, {
        align: "center",
      });

      doc.moveDown(2);

      // 📱 QR centrado
      doc.image(qr, {
        fit: [200, 200],
        align: "center",
      });

      // 👉 Evitar página extra al final
      if (i !== result.rows.length - 1) {
        doc.addPage();
      }
    }

    doc.end();
  } catch (error) {
    console.error("Error generando PDF:", error);
    res.status(500).send("Error generando PDF");
  }
});

// =====================================
// 🗳 VOTAR DATA
// =====================================

app.get("/votar-data/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const votante = await pool.query(
      "SELECT * FROM votantes WHERE qr_token=$1",
      [token]
    );

    if (votante.rows.length === 0) {
      return res.status(404).json({ error: "QR inválido" });
    }

    const votacion = await pool.query(
      "SELECT * FROM votaciones WHERE estado='activa' LIMIT 1"
    );

    if (votacion.rows.length === 0) {
      return res.status(400).json({ error: "No hay votaciones activas" });
    }

    const votacionActual = votacion.rows[0];

    const yaVoto = await pool.query(
      "SELECT * FROM votos WHERE votante_id=$1 AND votacion_id=$2",
      [votante.rows[0].id, votacionActual.id]
    );

    if (yaVoto.rows.length > 0) {
      return res.status(400).json({ error: "Ya votaste" });
    }

    const candidatos = await pool.query(
      "SELECT * FROM candidatos WHERE votacion_id=$1",
      [votacionActual.id]
    );

    res.json({
      votante: votante.rows[0],
      votacion: votacionActual,
      candidatos: candidatos.rows,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error servidor" });
  }
});

// =====================================
// 🗳 VOTAR
// =====================================

app.post("/votar", async (req, res) => {
  try {
    const { votante_id, candidato_id } = req.body;

    const votante = await pool.query(
      "SELECT * FROM votantes WHERE id=$1",
      [votante_id]
    );

    if (votante.rows.length === 0) {
      return res.status(404).json({ error: "Votante no existe" });
    }

    const votacion = await pool.query(
      "SELECT * FROM votaciones WHERE estado='activa' LIMIT 1"
    );

    const votacionId = votacion.rows[0].id;

    const yaVoto = await pool.query(
      "SELECT * FROM votos WHERE votante_id=$1 AND votacion_id=$2",
      [votante_id, votacionId]
    );

    if (yaVoto.rows.length > 0) {
      return res.status(400).json({ error: "Ya votaste" });
    }

    // 🔒 VALIDACIÓN AGREGADA
    const candidato = await pool.query(
      "SELECT * FROM candidatos WHERE id=$1",
      [candidato_id]
    );

    if (candidato.rows.length === 0) {
      return res.status(400).json({ error: "Candidato inválido" });
    }

    await pool.query(
      "INSERT INTO votos (votante_id, candidato_id, votacion_id) VALUES ($1,$2,$3)",
      [votante_id, candidato_id, votacionId]
    );

    res.json({ ok: true });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error al votar" });
  }
});

// =====================================
// 📊 RESULTADOS POR VOTACIÓN
// =====================================

app.get("/resultados/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const resultados = await pool.query(`
      SELECT 
        c.id,
        c.nombre,
        c.foto,
        COUNT(v.id) as votos
      FROM candidatos c
      LEFT JOIN votos v ON v.candidato_id = c.id
      WHERE c.votacion_id = $1
      GROUP BY c.id, c.nombre, c.foto
      ORDER BY votos DESC
    `, [id]);

    res.json(resultados.rows);

  } catch (error) {
    console.error("❌ ERROR RESULTADOS:", error);
    res.status(500).json({ error: "Error obteniendo resultados" });
  }
});

// =====================================
// 📄 PDF RESULTADOS
// =====================================

app.get("/pdf-resultados/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const resultados = await pool.query(`
      SELECT 
        c.nombre,
        COUNT(v.id) as votos
      FROM candidatos c
      LEFT JOIN votos v ON v.candidato_id = c.id
      WHERE c.votacion_id = $1
      GROUP BY c.nombre
      ORDER BY votos DESC
    `, [id]);

    const totalRes = await pool.query(
      "SELECT COUNT(*) FROM votos WHERE votacion_id=$1",
      [id]
    );

    const total = parseInt(totalRes.rows[0].count);

    const doc = new PDFDocument();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "inline; filename=resultados.pdf"
    );

    doc.pipe(res);

    doc.fontSize(20).text("Resultados de la votación", {
      align: "center",
    });

    doc.moveDown();

    resultados.rows.forEach((r, index) => {
      const porcentaje = total > 0
        ? ((r.votos / total) * 100).toFixed(1)
        : 0;

      doc
        .fontSize(14)
        .text(
          `${index + 1}. ${r.nombre} - ${r.votos} votos (${porcentaje}%)`
        );
    });

    doc.moveDown();
    doc.text(`Total de votos: ${total}`);

    doc.end();

  } catch (error) {
    console.error("❌ Error PDF resultados:", error);
    res.status(500).json({ error: "Error generando PDF" });
  }
});

// =====================================
// 📊 ESTADO DE VOTACIÓN
// =====================================

app.get("/estado-votacion/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const votos = await pool.query(
      "SELECT COUNT(*) FROM votos WHERE votacion_id=$1",
      [id]
    );

    const votacion = await pool.query(
      "SELECT * FROM votaciones WHERE id=$1",
      [id]
    );

    if (votacion.rows.length === 0) {
      return res.status(404).json({ error: "Votación no existe" });
    }

    const votosActuales = parseInt(votos.rows[0].count);
    const max = votacion.rows[0].max_votantes || 0;

    res.json({
      votos_actuales: votosActuales,
      max_votantes: max,
      restantes: max - votosActuales,
      estado: votacion.rows[0].estado,
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error estado votación" });
  }
});

// =====================================
// 🚀 SERVIDOR
// =====================================

app.listen(3000, "0.0.0.0", () => {
  console.log("🔥 SERVIDOR CORRIENDO");
});



// =====================================
// 🗳 TEST VOTACIONES MULTIPLES
// =====================================

app.get("/test-multiples", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM votaciones_multiples"
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Error obteniendo votaciones múltiples",
    });
  }
})


// =====================================
// 🗳 CREAR VOTACIÓN MÚLTIPLE
// =====================================

app.post("/votaciones-multiples", async (req, res) => {
  try {
    const { nombre, max_selecciones, candidatos } = req.body;

    if (!nombre) {
      return res.status(400).json({ error: "Nombre requerido" });
    }

    if (!max_selecciones || max_selecciones <= 0) {
      return res.status(400).json({ error: "Número máximo de selecciones requerido" });
    }

    if (!candidatos || !Array.isArray(candidatos) || candidatos.length === 0) {
      return res.status(400).json({ error: "Debe agregar candidatos" });
    }

    if (max_selecciones > candidatos.length) {
      return res.status(400).json({
        error: "El máximo de selecciones no puede ser mayor al número de candidatos",
      });
    }

    const nuevaVotacion = await pool.query(
      `INSERT INTO votaciones_multiples (nombre, max_selecciones, estado)
       VALUES ($1, $2, 'inactiva')
       RETURNING *`,
      [nombre, max_selecciones]
    );

    const votacionId = nuevaVotacion.rows[0].id;

    for (const candidato of candidatos) {
      await pool.query(
        `INSERT INTO candidatos_multiples (votacion_id, nombre, foto)
         VALUES ($1, $2, $3)`,
        [votacionId, candidato.nombre, candidato.foto || null]
      );
    }

    res.json({
      mensaje: "Votación múltiple creada correctamente",
      votacion: nuevaVotacion.rows[0],
    });
  } catch (error) {
    console.error("Error creando votación múltiple:", error);
    res.status(500).json({ error: "Error creando votación múltiple" });
  }
});


// =====================================
// 🗳 OBTENER VOTACIÓN MÚLTIPLE ACTIVA
// =====================================

app.get("/votacion-multiple-activa", async (req, res) => {
  try {
    const votacionResult = await pool.query(
      `SELECT * FROM votaciones_multiples
       WHERE estado = 'activa'
       LIMIT 1`
    );

    if (votacionResult.rows.length === 0) {
      return res.status(404).json({
        error: "No hay votación múltiple activa",
      });
    }

    const votacion = votacionResult.rows[0];

    const candidatosResult = await pool.query(
      `SELECT * FROM candidatos_multiples
       WHERE votacion_id = $1`,
      [votacion.id]
    );

    res.json({
      votacion,
      candidatos: candidatosResult.rows,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Error obteniendo votación múltiple activa",
    });
  }
});


// =====================================
// 🟢 ACTIVAR VOTACIÓN MÚLTIPLE
// =====================================

app.put("/votaciones-multiples/activar/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar si existe votación normal activa
    const normalActiva = await pool.query(
      `SELECT * FROM votaciones
       WHERE estado = 'activa'
       LIMIT 1`
    );

    if (normalActiva.rows.length > 0) {
      return res.status(400).json({
        error:
          "Hay una votación normal activa. Debe desactivarla primero.",
      });
    }

    // Desactivar todas las múltiples
    await pool.query(
      `UPDATE votaciones_multiples
       SET estado = 'inactiva'`
    );

    // Activar la seleccionada
    const result = await pool.query(
      `UPDATE votaciones_multiples
       SET estado = 'activa'
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Votación múltiple no encontrada",
      });
    }

    res.json({
      mensaje: "Votación múltiple activada correctamente",
      votacion: result.rows[0],
    });
  } catch (error) {
    console.error("Error activando votación múltiple:", error);

    res.status(500).json({
      error: "Error activando votación múltiple",
    });
  }
});



// =====================================
// 🗳 DATOS PARA VOTACIÓN MÚLTIPLE
// =====================================

app.get("/votar-multiple-data/:token", async (req, res) => {
  try {
    const { token } = req.params;

    // Buscar votante
    const votanteResult = await pool.query(
      `SELECT * FROM votantes
       WHERE qr_token = $1`,
      [token]
    );

    if (votanteResult.rows.length === 0) {
      return res.status(404).json({
        error: "Votante no encontrado",
      });
    }

    const votante = votanteResult.rows[0];

    // Buscar votación múltiple activa
    const votacionResult = await pool.query(
      `SELECT * FROM votaciones_multiples
       WHERE estado = 'activa'
       LIMIT 1`
    );

    if (votacionResult.rows.length === 0) {
      return res.status(404).json({
        error: "No hay votación múltiple activa",
      });
    }

    const votacion = votacionResult.rows[0];

    // Verificar si ya votó
    const yaVotoResult = await pool.query(
      `SELECT * FROM votos_multiples
       WHERE votacion_id = $1
       AND votante_id = $2
       LIMIT 1`,
      [votacion.id, votante.id]
    );

    if (yaVotoResult.rows.length > 0) {
      return res.status(400).json({
        error: "Este votante ya votó en esta votación múltiple",
      });
    }

    // Obtener candidatos
    const candidatosResult = await pool.query(
      `SELECT * FROM candidatos_multiples
       WHERE votacion_id = $1
       ORDER BY id ASC`,
      [votacion.id]
    );

    res.json({
      votante,
      votacion,
      max_selecciones: votacion.max_selecciones,
      candidatos: candidatosResult.rows,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Error obteniendo datos para votación múltiple",
    });
  }
});

// =====================================
// 🗳 REGISTRAR VOTO MÚLTIPLE
// =====================================

app.post("/votar-multiple", async (req, res) => {
  try {
    const { token, candidato_ids } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token requerido" });
    }

    if (
      !candidato_ids ||
      !Array.isArray(candidato_ids) ||
      candidato_ids.length === 0
    ) {
      return res.status(400).json({ error: "Debe seleccionar candidatos" });
    }

    const idsConvertidos = candidato_ids.map((id) => Number(id));

    if (idsConvertidos.some((id) => !Number.isInteger(id) || id <= 0)) {
      return res.status(400).json({
        error: "Lista de candidatos inválida",
      });
    }

    const votanteResult = await pool.query(
      "SELECT * FROM votantes WHERE qr_token = $1",
      [token]
    );

    if (votanteResult.rows.length === 0) {
      return res.status(404).json({ error: "Votante no encontrado" });
    }

    const votante = votanteResult.rows[0];

    const votacionResult = await pool.query(
      "SELECT * FROM votaciones_multiples WHERE estado = 'activa' LIMIT 1"
    );

    if (votacionResult.rows.length === 0) {
      return res.status(404).json({ error: "No hay votación múltiple activa" });
    }

    const votacion = votacionResult.rows[0];

    if (votacion.estado !== "activa") {
      return res.status(400).json({
        error: "La votación múltiple no está activa",
      });
    }

    if (idsConvertidos.length > votacion.max_selecciones) {
      return res.status(400).json({
        error: `Solo puede seleccionar máximo ${votacion.max_selecciones} candidatos`,
      });
    }

    const idsUnicos = [...new Set(idsConvertidos)];

    if (idsUnicos.length !== idsConvertidos.length) {
      return res.status(400).json({
        error: "No puede repetir el mismo candidato",
      });
    }

    const candidatosValidosResult = await pool.query(
      `SELECT id FROM candidatos_multiples
       WHERE votacion_id = $1
       AND id = ANY($2::int[])`,
      [votacion.id, idsUnicos]
    );

    if (candidatosValidosResult.rows.length !== idsUnicos.length) {
      return res.status(400).json({
        error: "Uno o más candidatos no pertenecen a esta votación múltiple",
      });
    }

    const yaVotoResult = await pool.query(
      `SELECT id FROM votos_multiples
       WHERE votacion_id = $1 AND votante_id = $2
       LIMIT 1`,
      [votacion.id, votante.id]
    );

    if (yaVotoResult.rows.length > 0) {
      return res.status(400).json({
        error: "Este votante ya votó en esta votación múltiple",
      });
    }

    for (const candidatoId of idsUnicos) {
      await pool.query(
        `INSERT INTO votos_multiples (votacion_id, candidato_id, votante_id)
         VALUES ($1, $2, $3)`,
        [votacion.id, candidatoId, votante.id]
      );
    }

    res.json({
      mensaje: "Voto múltiple registrado correctamente",
      total_selecciones: idsUnicos.length,
    });
  } catch (error) {
    console.error("Error registrando voto múltiple:", error);
    res.status(500).json({ error: "Error registrando voto múltiple" });
  }
});


// =====================================
// 📊 RESULTADOS VOTACIÓN MÚLTIPLE
// =====================================

app.get("/resultados-multiples/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const votacionResult = await pool.query(
      `SELECT * FROM votaciones_multiples WHERE id = $1`,
      [id]
    );

    if (votacionResult.rows.length === 0) {
      return res.status(404).json({
        error: "Votación múltiple no encontrada",
      });
    }

    const votacion = votacionResult.rows[0];

    const resultadosResult = await pool.query(
      `
      SELECT 
        c.id,
        c.nombre,
        c.foto,
        COUNT(v.id)::int AS votos
      FROM candidatos_multiples c
      LEFT JOIN votos_multiples v 
        ON v.candidato_id = c.id
      WHERE c.votacion_id = $1
      GROUP BY c.id, c.nombre, c.foto
      ORDER BY votos DESC, c.nombre ASC
      `,
      [id]
    );

    const totalSeleccionesResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM votos_multiples WHERE votacion_id = $1`,
      [id]
    );

    const totalVotantesResult = await pool.query(
      `SELECT COUNT(DISTINCT votante_id)::int AS total FROM votos_multiples WHERE votacion_id = $1`,
      [id]
    );

    const totalSelecciones = totalSeleccionesResult.rows[0].total;
    const totalVotantes = totalVotantesResult.rows[0].total;

    const resultados = resultadosResult.rows.map((r) => ({
      ...r,
      porcentaje:
        totalSelecciones > 0
          ? Number(((r.votos / totalSelecciones) * 100).toFixed(2))
          : 0,
    }));

    res.json({
      votacion,
      total_votantes_que_votaron: totalVotantes,
      total_selecciones_registradas: totalSelecciones,
      max_selecciones_por_votante: votacion.max_selecciones,
      resultados,
    });
  } catch (error) {
    console.error("Error obteniendo resultados múltiples:", error);
    res.status(500).json({
      error: "Error obteniendo resultados múltiples",
    });
  }
});


// =====================================
// 📋 LISTAR VOTACIONES MÚLTIPLES
// =====================================

app.get("/votaciones-multiples", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM votaciones_multiples
       ORDER BY id DESC`
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error listando votaciones múltiples:", error);
    res.status(500).json({
      error: "Error listando votaciones múltiples",
    });
  }
});


// =====================================
// 🔴 DESACTIVAR VOTACIÓN MÚLTIPLE
// =====================================

app.put("/votaciones-multiples/desactivar/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE votaciones_multiples
       SET estado = 'inactiva'
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Votación múltiple no encontrada",
      });
    }

    res.json({
      mensaje: "Votación múltiple desactivada correctamente",
      votacion: result.rows[0],
    });
  } catch (error) {
    console.error("Error desactivando votación múltiple:", error);
    res.status(500).json({
      error: "Error desactivando votación múltiple",
    });
  }
});

// =====================================
// 🗑 ELIMINAR VOTACIÓN MÚLTIPLE
// =====================================

app.delete("/votaciones-multiples/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM votaciones_multiples
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Votación múltiple no encontrada",
      });
    }

    res.json({
      mensaje: "Votación múltiple eliminada correctamente",
      votacion: result.rows[0],
    });
  } catch (error) {
    console.error("Error eliminando votación múltiple:", error);
    res.status(500).json({
      error: "Error eliminando votación múltiple",
    });
  }
});


// =====================================
// 🟡 CERRAR VOTACIÓN MÚLTIPLE
// =====================================

app.put("/votaciones-multiples/cerrar/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE votaciones_multiples
       SET estado = 'cerrada'
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "Votación múltiple no encontrada",
      });
    }

    res.json({
      mensaje: "Votación múltiple cerrada correctamente",
      votacion: result.rows[0],
    });
  } catch (error) {
    console.error("Error cerrando votación múltiple:", error);
    res.status(500).json({
      error: "Error cerrando votación múltiple",
    });
  }
});


// =====================================
// 🔎 VERIFICAR TIPO DE VOTACIÓN ACTIVA
// =====================================

app.get("/tipo-votacion-activa", async (req, res) => {
  try {
    const normalResult = await pool.query(
      "SELECT * FROM votaciones WHERE estado='activa' LIMIT 1"
    );

    if (normalResult.rows.length > 0) {
      return res.json({
        tipo: "normal",
        mensaje: "Hay votación normal activa",
        votacion: normalResult.rows[0],
      });
    }

    const multipleResult = await pool.query(
      "SELECT * FROM votaciones_multiples WHERE estado='activa' LIMIT 1"
    );

    if (multipleResult.rows.length > 0) {
      return res.json({
        tipo: "multiple",
        mensaje: "Hay votación múltiple activa",
        votacion: multipleResult.rows[0],
      });
    }

    const normalesCreadas = await pool.query(
      "SELECT id FROM votaciones LIMIT 1"
    );

    const multiplesCreadas = await pool.query(
      "SELECT id FROM votaciones_multiples LIMIT 1"
    );

    if (
      normalesCreadas.rows.length === 0 &&
      multiplesCreadas.rows.length === 0
    ) {
      return res.json({
        tipo: "sin_votaciones",
        mensaje: "No hay votaciones creadas",
        votacion: null,
      });
    }

    return res.json({
      tipo: "sin_activas",
      mensaje: "No hay votaciones activadas",
      votacion: null,
    });
  } catch (error) {
    console.error("Error verificando tipo de votación activa:", error);
    res.status(500).json({
      error: "Error verificando tipo de votación activa",
    });
  }
});



// =====================================
// 📊 RESUMEN GENERAL VOTACIÓN MÚLTIPLE
// =====================================

app.get("/resumen-multiple/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const votacionResult = await pool.query(
      `SELECT * FROM votaciones_multiples WHERE id = $1`,
      [id]
    );

    const totalVotantesHabilitadosResult = await pool.query(
  `SELECT COUNT(*)::int AS total FROM votantes`
);

    if (votacionResult.rows.length === 0) {
      return res.status(404).json({
        error: "Votación múltiple no encontrada",
      });
    }

    const votacion = votacionResult.rows[0];

    const candidatosResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM candidatos_multiples WHERE votacion_id = $1`,
      [id]
    );

    const votantesResult = await pool.query(
      `SELECT COUNT(DISTINCT votante_id)::int AS total FROM votos_multiples WHERE votacion_id = $1`,
      [id]
    );

    const seleccionesResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM votos_multiples WHERE votacion_id = $1`,
      [id]
    );

    res.json({
      votacion,
      total_candidatos: candidatosResult.rows[0].total,
      total_votantes_habilitados: totalVotantesHabilitadosResult.rows[0].total,
      total_votantes_que_votaron: votantesResult.rows[0].total,
      total_selecciones_registradas: seleccionesResult.rows[0].total,
      max_selecciones_por_votante: votacion.max_selecciones,
      selecciones_posibles:
        votantesResult.rows[0].total * votacion.max_selecciones,
    });
  } catch (error) {
    console.error("Error obteniendo resumen múltiple:", error);
    res.status(500).json({
      error: "Error obteniendo resumen múltiple",
    });
  }
});


// =====================================
// 📄 PDF RESULTADOS VOTACIÓN MÚLTIPLE
// =====================================

app.get("/pdf-resultados-multiples/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const votacionResult = await pool.query(
      `SELECT * FROM votaciones_multiples WHERE id = $1`,
      [id]
    );

    if (votacionResult.rows.length === 0) {
      return res.status(404).json({
        error: "Votación múltiple no encontrada",
      });
    }

    const votacion = votacionResult.rows[0];

    const resultadosResult = await pool.query(
      `
      SELECT 
        c.nombre,
        COUNT(v.id)::int AS votos
      FROM candidatos_multiples c
      LEFT JOIN votos_multiples v 
        ON v.candidato_id = c.id
      WHERE c.votacion_id = $1
      GROUP BY c.id, c.nombre
      ORDER BY votos DESC, c.nombre ASC
      `,
      [id]
    );

    const totalSeleccionesResult = await pool.query(
      `SELECT COUNT(*)::int AS total 
       FROM votos_multiples 
       WHERE votacion_id = $1`,
      [id]
    );

    const totalVotantesResult = await pool.query(
      `SELECT COUNT(DISTINCT votante_id)::int AS total 
       FROM votos_multiples 
       WHERE votacion_id = $1`,
      [id]
    );

    const totalSelecciones = totalSeleccionesResult.rows[0].total;
    const totalVotantes = totalVotantesResult.rows[0].total;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename=resultados-multiples-${id}.pdf`
    );

    const doc = new PDFDocument({ margin: 50 });
    doc.pipe(res);

    doc.fontSize(20).text("Resultados Votación Múltiple", {
      align: "center",
    });

    doc.moveDown();

    doc.fontSize(13).text(`Votación: ${votacion.nombre}`);
    doc.text(`Estado: ${votacion.estado}`);
    doc.text(`Máximo de selecciones por votante: ${votacion.max_selecciones}`);
    doc.text(`Votantes que votaron: ${totalVotantes}`);
    doc.text(`Selecciones registradas: ${totalSelecciones}`);

    doc.moveDown();

    doc.fontSize(15).text("Resultados por candidato:");
    doc.moveDown(0.5);

    resultadosResult.rows.forEach((r, index) => {
      const porcentaje =
        totalSelecciones > 0
          ? ((r.votos / totalSelecciones) * 100).toFixed(2)
          : "0.00";

      doc
        .fontSize(12)
        .text(
          `${index + 1}. ${r.nombre} - ${r.votos} selecciones - ${porcentaje}%`
        );
    });

    doc.end();
  } catch (error) {
    console.error("Error generando PDF resultados múltiples:", error);
    res.status(500).json({
      error: "Error generando PDF resultados múltiples",
    });
  }
});