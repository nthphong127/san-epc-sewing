const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require("electron-log");
const sql = require("mssql");
const Datastore = require("nedb");
const path = require("path");
const os = require("os");
require("dotenv").config({ path: `${__dirname}/.env` });

// Cấu hình log cho autoUpdater
autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = "info";

// ===== Load cấu hình =====
const dbPath = path.join(__dirname, "offline.db");
const db = new Datastore({ filename: dbPath, autoload: true });

const stationNos = process.env.STATION_NO;
const factoryCodes = process.env.FACTORY_CODE;
const stationNoCus = process.env.STATION_NO_CUS;

// ===== Lấy địa chỉ IP local =====
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const interfaceName in interfaces) {
    for (const net of interfaces[interfaceName]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "Không tìm thấy IP";
}
const ipLocal = getLocalIP();

// ===== Cấu hình kết nối SQL Server =====
const config = {
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  port: 1433,
  options: {
    encrypt: false,
    enableArithAbort: true,
  },
  requestTimeout: 20000,
};

let mainWindow;
let isOnline = true; // Mặc định online

ipcMain.on("network-status", (event, status) => {
  isOnline = status;
});

// ===== Tạo cửa sổ chính =====
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("index.html");

  // Tự động kiểm tra cập nhật sau khi app khởi động
  autoUpdater.checkForUpdatesAndNotify();
}

// ===== Sự kiện app ready =====
app.whenReady().then(createWindow);

// ===== Đóng app nếu không phải macOS =====
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ===== Tự động cập nhật =====
autoUpdater.on("update-available", () => {
  log.info("Có bản cập nhật mới.");
  mainWindow.webContents.send("update_available");
});

autoUpdater.on("update-downloaded", () => {
  log.info("Đã tải xong bản cập nhật.");
  dialog.showMessageBox({
    type: "info",
    title: "Cập nhật có sẵn",
    message: "Phiên bản mới đã được tải về. Bạn có muốn cập nhật ngay không?",
    buttons: ["Cập nhật", "Để sau"]
  }).then(result => {
    if (result.response === 0) {
      autoUpdater.quitAndInstall();
    }
  });
});

ipcMain.on("install_update", () => {
  autoUpdater.quitAndInstall();
});


ipcMain.handle(
  "call-stored-procedure",
  async (event, procedureName, params) => {
    try {
      // Kết nối đến SQL Server
      const pool = await sql.connect(config);

      // Tạo truy vấn với thủ tục lưu trữ
      const request = pool.request();
      params.forEach((param, index) => {
        request.input(`param${index + 1}`, param); // Thêm tham số
      });

      const result = await request.execute(procedureName); // Gọi thủ tục lưu trữ
      return result.recordset; // Trả về kết quả
    } catch (error) {
      console.error("Lỗi gọi thủ tục lưu trữ:", error.message);
      throw error;
    } finally {
      await sql.close(); // Đóng kết nối
    }
  }
);

// Đếm số lượng tem bên mình
ipcMain.handle("get-data-count", async (event, factoryCode, stationNo) => {
  try {
    const pool = await sql.connect(config);
    const query = `
     DECLARE @DayNow DATETIME = CAST(GETDATE() AS DATE);

        SELECT COUNT(DISTINCT dv_RFIDrecordmst.EPC_Code) AS dataCounts
FROM dv_RFIDrecordmst
WHERE 
    FC_server_code = @FactoryCode
    AND record_time > @DayNow
    AND stationNO = @StationNo;
    `;

    const result = await pool
      .request()
      .input("FactoryCode", sql.NVarChar, factoryCodes)
      .input("StationNo", sql.NVarChar, stationNos)
      .query(query);

    await sql.close();

    // Trả về số liệu đếm
    return { success: true, count: result.recordset[0].dataCounts };
  } catch (error) {
    console.error("Database query error:", error);
    return { success: false, message: error.message };
  }
});

const fs = require("fs"); // Import module file system

// Tạo ngày hiện tại theo format YYYY-MM-DD
const today = new Date();
const dateString = today.toISOString().slice(0, 10); // "2025-04-26"

// Tạo đường dẫn log mới theo ngày
const logDir = path.join(__dirname, "logs");

// Kiểm tra nếu thư mục log chưa tồn tại thì tạo mới
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

ipcMain.handle("call-sp-upsert-epc", async (event, epc, stationNo) => {
  if (!isOnline) {
    try {
      const record = {
        epc,
        stationNos,
        ipLocal,
        synced: 0, // Chưa đồng bộ
        created_at: new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString(),
      };
      db.insert(record, (err, newDoc) => {
        if (err) {
          console.error("Error saving to NeDB:", err.message);
          return { success: false, message: "Error saving data locally." };
        }
        console.log("Saved to NeDB successfully:", newDoc);
      });
      return { success: false, message: "Offline: Data saved locally." };
    } catch (err) {
      console.error("Error saving to NeDB:", err.message);
      return { success: false, message: "Error saving data locally." };
    }
  }

  // Nếu online, xử lý logic SQL Server
  try {
    console.log(ipLocal);

    const pool = await sql.connect(config);
    const result = await pool
      .request()
      .input("EPC", sql.NVarChar, epc)
      .input("StationNo", sql.NVarChar, stationNos)
      .input("IP", sql.NVarChar, ipLocal)
      .execute("SP_UpsertEpcRecord_phong");

    // Nếu stored procedure chạy thành công
    const now = new Date();
    const formattedNow = now
      .toLocaleString()
      .replace("T", " ")
      .substring(0, 19); // "2025-04-04 12:00:00"

    // Log kết quả procedure
    if (result.returnValue === 1) {
      console.log("Stored procedure executed successfully.");
    } else {
      console.log("Stored procedure executed with errors.");
    }

    console.log("Logged EPC to file:", epc);

    return { success: true, returnValue: result.returnValue };
  } catch (err) {
    console.error("Error executing stored procedure:", err.message);
    return { success: false, message: "Error executing stored procedure." };
  } finally {
    sql.close();
  }
});

ipcMain.handle(
  "get-top-epc-records",
  async (event, factoryCode, stationNo, dayNow) => {
    try {
      const pool = await sql.connect(config);

      const query = ` 
       DECLARE @DayNow DATETIME = CAST(GETDATE() AS DATE);
        SELECT TOP 10 r.EPC_Code, r.size_code, r.mo_no, r.matchkeyid, r.created
        FROM dv_RFIDrecordmst r
        WHERE StationNo LIKE @StationNo
          AND record_time > @DayNow
        ORDER BY COALESCE(r.updated, r.record_time) DESC;
        `;

      const result = await pool
        .request()
        .input("FactoryCode", sql.NVarChar, factoryCodes)
        .input("StationNo", sql.NVarChar, stationNos)
        .query(query);

      await sql.close();

      return { success: true, records: result.recordset };
    } catch (error) {
      console.error("Database query error:", error);
      return { success: false, message: error.message };
    }
  }
);
ipcMain.handle("get-infor", async (event, epc) => {
  try {
    const pool = await sql.connect(config);

    const query = `
      SELECT dr.mo_no, dr.size_numcode  
      FROM dv_rfidmatchmst dr 
      WHERE dr.EPC_Code = @epc
        AND dr.ri_cancel = '0';
    `;

    const result = await pool
      .request()
      .input("epc", sql.NVarChar, epc)
      .query(query);

    await sql.close();

    return { success: true, record: result.recordset[0] || null };
  } catch (error) {
    console.error("Database query error:", error);
    return { success: false, message: error.message };
  }
});

const logDeleteFilePath = path.join(logDir, "delete.log"); // Đường dẫn file log delete
// Kiểm tra nếu thư mục log chưa tồn tại thì tạo mới
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log("Created log directory:", logDir);
}

ipcMain.handle(
  "delete-epc-record",
  async (event, matchkeyid, stationNo, epcCode) => {
    try {
      console.log(matchkeyid, "keyidkeyid");
      const pool = await sql.connect(config);

      // Tạo truy vấn xóa từ bảng dv_RFIDrecordmst
      const deleteQueryMain = `
      DELETE FROM dv_RFIDrecordmst
      WHERE matchkeyid = @matchkeyid AND StationNo LIKE @StationNo
    `;

      // Tạo truy vấn xóa từ bảng dv_RFIDrecordmst_backup_Daily
      const deleteQueryBackup = `
      DELETE FROM dv_RFIDrecordmst_backup_Daily
      WHERE matchkeyid = @matchkeyid AND StationNo LIKE @StationNo
    `;

      // Thực hiện xóa trong cả hai bảng
      await pool
        .request()
        .input("matchkeyid", sql.NVarChar, matchkeyid)
        .input("StationNo", sql.NVarChar, stationNos)
        .query(deleteQueryMain);

      await pool
        .request()
        .input("matchkeyid", sql.NVarChar, matchkeyid)
        .input("StationNo", sql.NVarChar, stationNos)
        .query(deleteQueryBackup);

      await sql.close();
      const logEntry = `[${new Date().toISOString()}] Matchkeyid Deleted: ${matchkeyid}, EPC: ${epcCode}, stationNo: ${stationNo}\n`;
      fs.appendFileSync(logDeleteFilePath, logEntry);

      return { success: true };
    } catch (error) {
      console.error("Error deleting EPC record:", error.message);
      return { success: false, message: error.message };
    }
  }
);

ipcMain.handle("show-confirm-dialog", async (event, message) => {
  const result = dialog.showMessageBoxSync({
    type: "question",
    buttons: ["OK", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: "",
    detail: message,
  });
  return result === 0;
});

ipcMain.handle("get-qty-target", async (event, message) => {
  try {
    const pool = await sql.connect(config);

    const query = `
     SELECT TOP 1 a.pr_qty FROM  dv_production_daily a 
      LEFT JOIN dv_rfidreader b ON a.pr_dept_code  = b.dept_code
      WHERE a.pr_date = CAST(GETDATE() AS DATE)
      AND b.device_name = @StationNo;
    `;

    const result = await pool
      .request()
      .input("StationNo", sql.NVarChar, stationNos)
      .query(query);

    await sql.close();

    return { success: true, record: result.recordset[0] || null };
  } catch (error) {
    console.error("Database query error:", error);
    return { success: false, message: error.message };
  }
});

//*********************Xử lý data offline**************************//

ipcMain.handle("sync-offline-data", async () => {
  try {
    if (!isOnline) {
      console.log("Network is still offline. Cannot sync.");
      return { success: false, message: "Network is offline." };
    }


    // Lấy tất cả các bản ghi chưa đồng bộ từ NeDB
    const rows = await new Promise((resolve, reject) => {
      db.find({ synced: 0 }, (err, docs) => {
        if (err) return reject(err);
        resolve(docs);
      });
    });

    if (rows.length === 0) {
      console.log("No offline data to sync.");
      return { success: true, message: "No data to sync." };
    }

    const pool = await sql.connect(config);

    // Đồng bộ từng bản ghi
    for (const row of rows) {
      try {
        await pool
          .request()
          .input("EPC", sql.NVarChar, row.epc)
          .input("StationNo", sql.NVarChar, row.stationNos)
          .input("IP", sql.NVarChar, ipLocal)
          .input("record_time", sql.DateTime, new Date(row.created_at)) // Sửa chỗ này
          .execute("SP_UpsertEpcRecord_phong");
    
        await new Promise((resolve, reject) => {
          db.update(
            { _id: row._id },
            { $set: { synced: 1 } },
            {},
            (err, numReplaced) => {
              if (err) return reject(err);
              resolve(numReplaced);
            }
          );
        });
        console.log("Synced record:", row);
      } catch (err) {
        console.error("Error syncing record:", row, err.message);
      }
    }
    

    // Xóa các bản ghi đã đồng bộ
    await new Promise((resolve, reject) => {
      db.remove({ synced: 1 }, { multi: true }, (err, numRemoved) => {
        if (err) return reject(err);
        console.log(`Deleted ${numRemoved} synced records.`);
        resolve(numRemoved);
      });
    });

    await sql.close();
    return { success: true, message: "Sync completed successfully." };
  } catch (error) {
    console.error("Error during sync:", error.message);
    return { success: false, message: error.message };
  }
});

ipcMain.handle("get-station-name", async (event, { stationNo, lang }) => {
  const langColumnMap = {
    vn: "Vietnamese",
    cn: "SimplifiedChinese",
    kh: "Khmer",
    en: "English",
  };

  const columnName = langColumnMap[lang] || "English";

  try {
    await sql.connect(config);
    const query = `
      SELECT TOP 1 [${columnName}] AS StationName
      FROM dv_rfidreader
      WHERE device_name = @stationNo
    `;
    const request = new sql.Request();
    request.input("stationNo", sql.VarChar, stationNo);

    const result = await request.query(query);
    if (result.recordset.length > 0) {
      return result.recordset[0].StationName;
    } else {
      return stationNo; // fallback nếu không có
    }
  } catch (err) {
    console.error("Lỗi khi truy vấn tên station:", err);
    return stationNo;
  }
});


ipcMain.handle("check-assembly-status", async (event, epc) => {
  try {
    const pool = await sql.connect(config);

    const query = `
      SELECT TOP 1 drbd.stationNO  
      FROM dv_RFIDrecordmst_backup_Daily drbd
      JOIN dv_rfidmatchmst dr ON dr.keyid = drbd.matchkeyid
      WHERE dr.EPC_Code = @epc 
        AND dr.ri_cancel = '0'
        AND drbd.stationNO LIKE '%p_101%'
    `;

    const result = await pool
      .request()
      .input("epc", sql.NVarChar, epc)
      .query(query);

    await sql.close();

    const record = result.recordset[0] || null;

    const isMatch = record && record.stationNO == stationNos;

    return { success: true, match: isMatch };
  } catch (error) {
    console.error("Database query error:", error);
    return { success: false, message: error.message };
  }
});






