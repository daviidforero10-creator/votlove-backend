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
const FRONT_URL = "https://votlove.web.app"

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

    res.json(votacion);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error creando votación" });
  }
});

// =====================================
// 🟢 ACTIVAR / DESACTIVAR / CERRAR
// =====================================

app.put("/votaciones/activar/:id", async (req, res) => {
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
  const url = `${FRONT_URL}/#/votar/${req.params.token}`;
  const qr = await QRCode.toBuffer(url);
  res.setHeader("Content-Type", "image/png");
  res.send(qr);
});

// =====================================
// 📄 PDF
// =====================================

app.get("/pdf-votantes", async (req, res) => {
  const result = await pool.query("SELECT * FROM votantes");
  const doc = new PDFDocument();
  doc.pipe(res);

  for (const v of result.rows) {
    const url = `${FRONT_URL}/#/votar/${v.qr_token}`;
    const qr = await QRCode.toBuffer(url);

    doc.text(v.nombre, { align: "center" });
    doc.image(qr, { fit: [200, 200], align: "center" });
    doc.addPage();
  }

  doc.end();
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