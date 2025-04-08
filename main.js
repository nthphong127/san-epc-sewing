const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const sql = require("mssql");
const Datastore = require("nedb");
const path = require("path");

const dbPath = path.join(__dirname, "offline.db");
const db = new Datastore({ filename: dbPath, autoload: true });


require("dotenv").config({ path: `${__dirname}/.env` });

var stationNos = process.env.STATION_NO;
var factoryCodes = process.env.FACTORY_CODE;
var stationNoCus = process.env.STATION_NO_CUS;
const os = require('os');

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        for (const net of interfaces[interfaceName]) {
            // Chỉ lấy IPv4 và bỏ qua địa chỉ loopback
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'Không tìm thấy IP';
}
var ipLocal = getLocalIP();// get ip local address

var ipLocal = getLocalIP();// get ip local address

// Cấu hình kết nối SQL Server
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

let isOnline = true; // Mặc định là online

ipcMain.on("network-status", (event, status) => {
  isOnline = status; // Cập nhật trạng thái mạng
  // console.log("Network status updated:", isOnline ? "Online" : "Offline");
});

// Khởi tạo ứng dụng Electron
app.on("ready", () => {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    // fullscreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("index.html");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ipcMain.handle("check-db-connection", async () => {
// try {
// const pool = await sql.connect(config);
// // await sql.close();
// return { success: true, message: "Database connected" };
// } catch (error) {
// return { success: false, message: error.message };
// }
// });
// Hàm xử lý gọi thủ tục lưu trữ qua IPC
// console.log("Database Server:", config.server);
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

const logDir = path.join(__dirname, "log"); // Đường dẫn thư mục log
const logFilePath = path.join(logDir, "epc_success.log"); // Đường dẫn file log

// Kiểm tra nếu thư mục log chưa tồn tại thì tạo mới
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log("Created log directory:", logDir);
}

ipcMain.handle("call-sp-upsert-epc", async (event, epc, stationNo) => {
  if (!isOnline) {
    try {
      const record = {
        epc,
        stationNos,
        ipLocal,
        synced: 0, // Chưa đồng bộ
        created_at: new Date().toISOString(),
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
    if (result.returnValue === 1) {
      const logEntry = `[${new Date().toISOString()}] EPC Scan Success: ${epc}\n`;

      // Kiểm tra nếu thư mục log chưa tồn tại thì tạo mới (phòng khi có lỗi xóa thư mục)
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      // Ghi log vào file
      fs.appendFileSync(logFilePath, logEntry);
      console.log("Logged EPC to file:", epc);
    }

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
  async (event, factoryCodes, stationNos, dayNow) => {
    try {
      const pool = await sql.connect(config);

      const query = `
        SELECT TOP 10 r.EPC_Code, r.size_code, r.mo_no, r.matchkeyid, r.created
        FROM dv_RFIDrecordmst r
        WHERE StationNo LIKE @StationNo
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

//*********************Xử lý data offline**************************//

ipcMain.handle("sync-offline-data", async () => {
  try {
    if (!isOnline) {
      console.log("Network is still offline. Cannot sync.");
      return { success: false, message: "Network is offline." };
    }

    console.log("Fetching offline data for sync...");

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
          .execute("SP_UpsertEpcRecord_phong");

        // Cập nhật trạng thái bản ghi là đã đồng bộ
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
