const { ipcRenderer } = require("electron");

//**************Kiểm tra mạng************//
var tableBody = document.getElementById("table-body");
let previousMoNo = null;
let hasNotified = true;
const Datastore = require("nedb");
const path = require("path");
const fs = require("fs");

// Đường dẫn tới thư mục db và log
const logDir = path.join(__dirname, "logs");
const dbDir = path.join(__dirname, "db");


// Hàm lấy ngày hiện tại dạng YYYY-MM-DD
function getTodayDateStr() {   
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Hàm định dạng lại thời gian theo kiểu "YYYY-MM-DD HH:mm:ss.SSS"
function formatDate(date) {
  const pad = (num, size = 2) => String(num).padStart(size, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  );
}

// Ghi log ra file
function logToFile(filePath, message) {
  const logEntry = {
    message,
    timestamp: formatDate(new Date()),
  };
  fs.appendFileSync(filePath, JSON.stringify(logEntry) + "\n");
}

// Xóa các file log cũ hơn 3 ngày
function cleanOldLogs() {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 3); // 3 ngày trước

  fs.readdirSync(logDir).forEach((file) => {
    if (!file.endsWith(".log")) return;

    // Ví dụ tên: epc_success_2025-05-05.log
    const match = file.match(/\d{4}-\d{2}-\d{2}/); // tìm chuỗi ngày
    if (!match) {
      console.warn("File log sai định dạng:", file);
      return;
    }

    const fileDate = new Date(match[0]);
    if (!isNaN(fileDate) && fileDate < cutoffDate) {
      fs.unlinkSync(path.join(logDir, file));
      console.log("Đã xóa file log cũ:", file);
    }
  });
}

// Tạo thư mục db và logs nếu chưa có
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

// Xóa các file DB cũ không phải ngày hôm nay
const todayStr = getTodayDateStr();
fs.readdirSync(dbDir).forEach((file) => {
  if (!file.includes(todayStr) && file.endsWith(".db")) {
    fs.unlinkSync(path.join(dbDir, file));
    console.log("Đã xóa file DB cũ:", file);
  }
});

// Tạo các DB file theo ngày
const errorDb = new Datastore({ filename: path.join(dbDir, `errors_${todayStr}.db`), autoload: true });
const lastDb = new Datastore({ filename: path.join(dbDir, `last_${todayStr}.db`), autoload: true });
const db = new Datastore({ filename: path.join(dbDir, `epc_success_${todayStr}.db`), autoload: true });

// Tạo các file log theo ngày
const successLogFile = path.join(logDir, `epc_success_${todayStr}.log`);
const failLogFile = path.join(logDir, `epc_fail_${todayStr}.log`);

// Xóa log cũ
cleanOldLogs();


let lastList = [];
function checkOnlineStatus() {
  const networkButton = document.getElementById("networkButton");
  const statusElement = document.getElementById("status");

  if (navigator.onLine) {
    fetch("https://www.google.com", {
      method: "HEAD",
      cache: "no-store",
    })
      .then((response) => {
        if (response.ok) {
          statusElement.innerText = "Network Status: Online";
          networkButton.classList.remove("offline");
          networkButton.classList.add("online");
          ipcRenderer.send("network-status", true); // Gửi trạng thái online
        } else {
          statusElement.innerText = "Network Status: Offline";
          networkButton.classList.remove("online");
          networkButton.classList.add("offline");
          ipcRenderer.send("network-status", false); // Gửi trạng thái offline
        }
      })
      .catch(() => {
        statusElement.innerText = "Network Status: Offline";
        networkButton.classList.remove("online");
        networkButton.classList.add("offline");
        ipcRenderer.send("network-status", false); // Gửi trạng thái offline
      });
  } else {
    statusElement.innerText = "Network Status: Offline";
    networkButton.classList.remove("online");
    networkButton.classList.add("offline");
    ipcRenderer.send("network-status", false); // Gửi trạng thái offline
  }
}

window.addEventListener("online", () => {
  checkOnlineStatus();
});
window.addEventListener("offline", () => {
  checkOnlineStatus();
});

// Update the status every 3 seconds
setInterval(checkOnlineStatus, 5000);

//**************Hiển thị thời gian************//
function updateTime() {
  const currentDate = new Date();
  const dateFormatted = currentDate.toLocaleString();
  document.getElementById("timer").innerText = `TIME: ${dateFormatted}`;
}

setInterval(updateTime, 1000);

//**************Đếm số lượng tem mình************//
async function fetchDataCount() {
  const dataCountElement = document.getElementById("data-count");

  try {
    const result = await ipcRenderer.invoke("get-data-count");
    if (result.success) {
      dataCountElement.innerText = `${result.count}`;
      dataCountElement.style.color = "white";
    } else {
      console.log(`Error: ${result.message}`);
      // dataCountElement.style.color = "red";
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
    // dataCountElement.innerText = `Error: ${error.message}`;
    // dataCountElement.style.color = "red";
  }
}

//**************TABLE***********//
async function renderTable() {
  const data = await fetchTableData();

  // Bước 1: Đếm tần suất mo_no
  const moNoCounts = {};
  data.forEach((item) => {
    moNoCounts[item.mo_no] = (moNoCounts[item.mo_no] || 0) + 1;
  });

  // Bước 2: Tìm mo_no xuất hiện nhiều nhất
  let maxMoNo = null;
  let maxCount = 0;
  for (const moNo in moNoCounts) {
    if (moNoCounts[moNo] > maxCount) {
      maxCount = moNoCounts[moNo];
      maxMoNo = moNo;
    }
  }

  // Bước 3: Gán màu cho các mo_no lẻ
  const colorClasses = ["blink-color-1", "blink-color-2", "blink-color-3", "blink-color-4"];
  const moNoToColorClass = {};
  let colorIndex = 0;

  data.forEach(item => {
    if (item.mo_no !== maxMoNo && !moNoToColorClass[item.mo_no]) {
      moNoToColorClass[item.mo_no] = colorClasses[colorIndex % colorClasses.length];
      colorIndex++;
    }
  });

  // Bước 4: Render bảng
  tableBody.innerHTML = "";
  data.forEach((item) => {
    const row = document.createElement("tr");
    row.setAttribute("data-keyid", item.matchkeyid);

    const epcCell = document.createElement("td");
    epcCell.textContent = item.EPC_Code;

    const sizeCell = document.createElement("td");
    sizeCell.textContent = item.size_code;

    const monoCell = document.createElement("td");
    monoCell.textContent = item.mo_no;

    const actionCell = document.createElement("td");
    const deleteIcon = document.createElement("span");
    deleteIcon.textContent = "Xóa";
    deleteIcon.classList.add("delete-icon");

    // Nếu là mo_no lẻ => gán class màu riêng
    if (item.mo_no !== maxMoNo) {
      const colorClass = moNoToColorClass[item.mo_no];
      row.classList.add(colorClass);
      deleteIcon.classList.add(colorClass);
    }

    deleteIcon.addEventListener("click", () => {
      const matchkeyid = row.getAttribute("data-keyid");
      console.log("Deleting row with keyid:", matchkeyid);
      deleteRow(item.EPC_Code, matchkeyid);
    });

    actionCell.appendChild(deleteIcon);

    row.appendChild(epcCell);
    row.appendChild(sizeCell);
    row.appendChild(monoCell);
    row.appendChild(actionCell);
    tableBody.appendChild(row);
  });
}


//**************Lấy data show vào table ***********//
async function fetchTableData() {
  try {
    // Gọi IPC để lấy dữ liệu từ backend
    const result = await ipcRenderer.invoke("get-top-epc-records");
    const currentMono = result.records[0]?.mo_no;
    if (result.success) {
      if (previousMoNo && currentMono && currentMono !== previousMoNo) {
        if (!hasNotified) {
          // notiSound.play();
          hasNotified = true; // Đặt cờ đã phát âm thanh
        }
      } else {
        hasNotified = true;
      }

      // Cập nhật giá trị mo_no cho lần tiếp theo
      previousMoNo = currentMono;

      return result.records; // Trả về dữ liệu từ backend
    } else {
      console.error("Error fetching data:", result.message);
      return [];
    }
  } catch (err) {
    console.error("Error fetching table data:", err);
    return [];
  }
}

//************** Xóa EPC ***********//
async function deleteRow(epcCode, keyid) {
  try {
    const confirmation = await ipcRenderer.invoke(
      "show-confirm-dialog",
      `Bạn có chắc chắn muốn xóa EPC Code: ${epcCode}?`
    );

    if (confirmation) {
      const result = await ipcRenderer.invoke(
        "delete-epc-record",
        keyid,
        "M",
        epcCode
      );

      if (result.success) {
        await renderTable();
        await fetchDataCount();
        epcCodeInput.focus();
      } else {
        console.error("Error deleting EPC record:", result.message);
      }
    } else {
      epcCodeInput.focus();
    }
  } catch (err) {
    console.error("Error deleting EPC record:", err);
  }
}

//**************Quét tem***********//
const epcCodeInput = document.getElementById("epc-code");
const successAnimation = document.getElementById("success-animation");

let typingTimeout;

epcCodeInput.addEventListener("input", () => {
  epcCodeInput.value = epcCodeInput.value.toUpperCase();
  // Nếu người dùng gõ lại, hủy timeout cũ
  clearTimeout(typingTimeout);

  // Thiết lập timeout mới, 500ms sau khi ngừng gõ
  typingTimeout = setTimeout(() => {
    // Lấy giá trị người dùng đã nhập
    const epcCode = epcCodeInput.value;

    if (epcCode.length !== 24 || !epcCode.startsWith("E")) {
      console.warn("EPC code must be 24 characters long and start with 'E'.");
      epcCodeInput.value = ""; // Xóa nội dung input
      return;
    }
    // Nếu epcCode có giá trị, gọi stored procedure
    if (epcCode) {
      addEPCRow(epcCode);
      console.log("Calling stored procedure with EPC:", epcCode);
 
      epcCodeInput.disabled = true;
      // Gọi hàm trong main process để xử lý stored procedure

      ipcRenderer
        .invoke("call-sp-upsert-epc", epcCode)
        .then(async (result) => {
          const infor = await ipcRenderer.invoke("get-infor", epcCode);
          let size = infor.success && infor.record ? infor.record.size_numcode : "Lỗi";
          let mono = infor.success && infor.record ? infor.record.mo_no : "Lỗi";
          if (result.success && result.returnValue == 0) {
            const notification = document.createElement("div");
            notification.className = "notification error";
            notification.innerText = `EPC chưa được phối hoặc bị lỗi: ${epcCode}`;
            document.body.appendChild(notification);

            // Ẩn thông báo sau 3 giây
            setTimeout(() => {
              notification.remove();
            }, 5000);
            errorList.push(epcCode);
            logToFile(failLogFile, `EPC ${epcCode}`);

            return;
          }
          if (result.success && result.returnValue === 1) {
            saveEpcIfNew(epcCode, (err, isNew, doc) => {
              if (err) {
                console.error("Lỗi khi lưu DB:", err);
                return;
              }
              if (!isNew) {
                // Đã quét rồi, hiển thị thông báo
                const notification = document.createElement("div");
                notification.className = "notification warning";
                notification.innerText = `EPC đã được quét hôm nay: ${epcCode} - Size:${size} -${mono} (Lúc: ${doc.record_time})`;
                document.body.appendChild(notification);
                lastList.push(epcCode);
                setTimeout(() => {
                  notification.remove();
                }, 5000);
              } else {
                logToFile(successLogFile, `${epcCode}`);
              }
            });
          }

          if (result.success && result.returnValue === -1) {
            db.findOne({ epc: epcCode }, (err, doc) => {
              if (err) {
                console.error("Lỗi DB khi kiểm tra EPC:", err);
                return;
              }

              const notification = document.createElement("div");

              let message = "";

              if (doc) {
                notification.className = "notification warning";
                // Tem đã được quét trong hôm nay
                message = `EPC đã được quét hôm nay: ${epcCode} - Size:${size} -${mono} (Lúc: ${doc.record_time})`;
                notification.innerText = message;
                document.body.appendChild(notification);
                setTimeout(() => {
                  notification.remove();
                }, 5000);
              } else {
                notification.className = "notification error      ";
                // Tem đã được quét vào ngày trước đó → log & lưu error
                message = `EPC đã được quét vào ngày trước đó: ${epcCode} - Size: ${size} - ${mono}`;
                notification.innerText = message;
                document.body.appendChild(notification);
                lastList.push(epcCode);

                // Kiểm tra nếu chưa có trong lastDb thì mới lưu
                lastDb.findOne({ epc: epcCode }, (err, existingError) => {
                  if (err) {
                    console.error("Lỗi DB khi kiểm tra lỗi EPC:", err);
                    return;
                  }

                  if (!existingError) {
                    const record = {
                      epc: epcCode,
                      record_time: formatDate(new Date()),
                    };
                    lastDb.insert(record);
                    logToFile(failLogFile, `${epcCode}`);
                  }
                });

                setTimeout(() => {
                  notification.remove();
                }, 5000);
              }
            });
          }
          updateLastCount();

          renderTable();
          fetchDataCount();
          successAnimation.classList.remove("hidden");
          successAnimation.classList.add("show");
          if (hasNotified) {
            hasNotified = false;
          }

          // Ẩn animation sau 1.5 giây
          setTimeout(() => {
            successAnimation.classList.remove("show");
            successAnimation.classList.add("hidden");
          }, 500000);
        })
        .catch((error) => {
          console.error("Error in stored procedure call:", error);
        })
        .finally(() => {
          epcCodeInput.disabled = false;
          // epcCodeInput.focus();
          epcCodeInput.value = "";
          epcCodeInput.focus();
        });
    }


    // Sau khi xử lý xong, xóa nội dung của input và focus lại
  }, 200); // 500ms = 0.5 giây
});

// Hàm thêm EPC vào bảng ngay lập tức
function addEPCRow(epcCode) {
  const row = document.createElement("tr");

  const epcCell = document.createElement("td");
  epcCell.textContent = epcCode;

  const sizeCell = document.createElement("td");
  sizeCell.textContent = ""; // Tạm thời để trống

  const monoCell = document.createElement("td");
  monoCell.textContent = ""; // Tạm thời để trống

  const actionCell = document.createElement("td");
  const deleteIcon = document.createElement("span");
  deleteIcon.textContent = "xóa";
  deleteIcon.classList.add("delete-icon");

  row.appendChild(epcCell);
  row.appendChild(sizeCell);
  row.appendChild(monoCell);
  row.appendChild(actionCell);

  if (tableBody.firstChild) {
    tableBody.insertBefore(row, tableBody.firstChild); // Thêm hàng vào đầu
  } else {
    tableBody.appendChild(row); // Nếu bảng trống, thêm vào đầu tiên
  }
}

function syncOfflineData() {
  const loadingIndicator = document.getElementById("loading-indicator");
  loadingIndicator.style.display = "flex"; // Hiển thị trạng thái loading

  ipcRenderer
    .invoke("sync-offline-data")
    .then((result) => {
      if (result && result.success) {
        // alert("Khởi động, và đồng bộ dữ liệu thành công !");
      } else {
        console.error(
          "Error syncing offline data:",
          result?.message || "Unknown error."
        );
      }
    })
    .catch((error) => {
      console.error("Error during sync:", error.message);
    })
    .finally(() => {
      loadingIndicator.style.display = "none";
    });
}

document.addEventListener("DOMContentLoaded", async () => {
  epcCodeInput.focus();
  if (navigator.onLine) {
    try {
      renderTable();
      fetchDataCount();
      syncOfflineData(), console.log("All tasks completed successfully.");
    } catch (error) {
      console.error("An error occurred during initialization:", error);
    }
  } else {
    console.log("App started offline. No sync will be performed.");
  }
});

// auto focus
document.addEventListener("click", (event) => {
  const epcCodeInput = document.getElementById("epc-code");

  if (event.target !== epcCodeInput) {
    epcCodeInput.focus();
  }
});

const stationNo = process.env.STATION_NO;

// Ghi vào HTML
const stationElement = document.querySelector("h2");
if (stationElement) {
  stationElement.textContent = `Trạm ${stationNo}`;
}

// modal
const errorBtn = document.querySelector(".error-epc-btn");
const modal = document.getElementById("error-modal");
const closeModalBtn = document.getElementById("close-modal-btn");
const errorTableBody = document.getElementById("error-table-body");
let errorList = [];
errorBtn.addEventListener("click", () => {
  updateErrorTable();
  modal.style.display = "flex";
});



// Đóng modal khi bấm nút close
closeModalBtn.addEventListener("click", () => {
  modal.style.display = "none";
});

// Ẩn modal khi bấm bên ngoài modal-content
window.addEventListener("click", (event) => {
  if (event.target === modal) {
    modal.style.display = "none";
  }
});

// Hàm cập nhật số lượng tem lỗi
function updateErrorCount() {
  errorDb.count({}, (err, count) => {
    if (err) {
      console.error("Failed to count errors in database:", err);
    } else {
      const errorCountSpan = document.getElementById("error-count");
      errorCountSpan.textContent = count; // Hiển thị số lượng tem lỗi
    }
  });
}

updateErrorCount();
// xóa error cuối ngày

function cleanOldData() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  errorDb.remove(
    { timestamp: { $lt: today.toISOString() } },
    { multi: true },
    (err, numRemoved) => {
      if (err) {
        console.error("Có lỗi xảy ra khi xóa dữ liệu:", err);
      } else {
        updateErrorCount();
      }
    }
  );
}

cleanOldData();

// xem lỗi

function updateErrorTable() {
  errorDb.find({}, (err, docs) => {
    if (err) {
      console.error("Failed to load errors from database:", err);
      return;
    }

    errorTableBody.innerHTML = ""; // Xóa nội dung cũ
    if (docs.length === 0) {
      errorTableBody.innerHTML = `<tr><td colspan="2">Không có EPC hỏng</td></tr>`;
      return;
    }

    docs.forEach((doc, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${doc.epcCode}</td>
        <td>
          <span hidden disabled class="delete-btn" data-id="${doc._id}">Xóa</span>
        </td>
      `;
      errorTableBody.appendChild(row);
    });

    // Thêm sự kiện xóa cho từng nút
    document.querySelectorAll(".delete-btn").forEach((button) => {
      button.addEventListener("click", (event) => {
        const id = event.target.dataset.id;
        removeError(id);
      });
    });
  });
}

function removeError(id) {
  errorDb.remove({ _id: id }, {}, (err, numRemoved) => {
    if (err) {
      console.error("Failed to remove error from database:", err);
    } else {
      updateErrorTable(); // Cập nhật lại bảng
      updateErrorCount(); // Cập nhật số lượng
    }
  });
}

// modal  last
const lastBtn = document.querySelector(".last-epc-btn");
const modalLast = document.getElementById("last-modal");
const closeModalLastBtn = document.getElementById("close-last-btn");
const lastTableBody = document.getElementById("last-table-body");

lastBtn.addEventListener("click", () => {
  updateLastTable();
  updateLastCount();
  modalLast.style.display = "flex";
});

function updateLastCount() {
  lastDb.count({}, (err, count) => {
    if (err) {
      console.error("Failed to count errors in database:", err);
    } else {
      const lastCountSpan = document.getElementById("last-count");
      lastCountSpan.textContent = count; // Hiển thị số lượng tem lỗi
    }
  });
}

updateLastCount();

// Cập nhật bảng tem lỗi
function updateLastTable() {
  lastTableBody.innerHTML = ""; // Xóa nội dung cũ
  if (lastList.length === 0) {
    lastTableBody.innerHTML = `<tr><td colspan="2">Không có EPC hỏng</td></tr>`;
    return;
  }
  lastList.forEach((error, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${error}</td>

    `;
    lastTableBody.appendChild(row);
  });

  // Thêm sự kiện xóa cho từng nút
}

// Đóng modal khi bấm nút close
closeModalLastBtn.addEventListener("click", () => {
  modalLast.style.display = "none";
});

// Ẩn modal khi bấm bên ngoài modal-content
window.addEventListener("click", (event) => {
  if (event.target === modalLast) {
    modalLast.style.display = "none";
  }
});

// Hàm cập nhật số lượng tem lỗi
function updateLastCount() {
  lastDb.count({}, (err, count) => {
    if (err) {
      console.error("Failed to count errors in database:", err);
    } else {
      const lastCountSpan = document.getElementById("last-count");
      lastCountSpan.textContent = count; // Hiển thị số lượng tem lỗi
    }
  });
}

updateLastCount();

function cleanOldDataLast() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  lastDb.remove(
    { timestamp: { $lt: today.toISOString() } },
    { multi: true },
    (err, numRemoved) => {
      if (err) {
        console.error("Có lỗi xảy ra khi xóa dữ liệu:", err);
      } else {
        updateLastCount();
      }
    }
  );
}

cleanOldDataLast();

// xem lỗi

function updateLastTable() {
  lastDb.find({}, (err, docs) => {
    if (err) {
      console.error("Failed to load errors from database:", err);
      return;
    }

    lastTableBody.innerHTML = ""; // Xóa nội dung cũ
    if (docs.length === 0) {
      lastTableBody.innerHTML = `<tr><td colspan="2">Không có EPC hỏng</td></tr>`;
      return;
    }

    docs.forEach((doc, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${doc.epc}</td>
        <td>
          <button hidden disabled class="delete-last-btn" data-id="${doc._id}">Xóa</button>
        </td>
      `;
      lastTableBody.appendChild(row);
    });

    // Thêm sự kiện xóa cho từng nút
    document.querySelectorAll(".delete-last-btn").forEach((button) => {
      button.addEventListener("click", (event) => {
        const id = event.target.dataset.id;
        removeLast(id);
      });
    });
  });
}

function removeLast(id) {
  lastDb.remove({ _id: id }, {}, (err, numRemoved) => {
    if (err) {
      console.error("Failed to remove error from database:", err);
    } else {
      updateLastTable(); // Cập nhật lại bảng
      updateLastCount(); // Cập nhật số lượng
    }
  });
}

function formatDate(date) {
  const pad = (num, size = 2) => String(num).padStart(size, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
      date.getDate()
    )} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}.${pad(date.getMilliseconds(), 3)}`
  );
}

function saveEpcIfNew(epc, callback) {
  db.findOne({ epc }, (err, doc) => {
    if (err) return callback(err);

    if (doc) {
      // Đã tồn tại
      callback(null, false, doc);
    } else {
      const record = {
        epc,
        record_time: formatDate(new Date()),
      };
      db.insert(record, (err, newDoc) => {
        if (err) return callback(err);
        callback(null, true, newDoc);
      });
    }
  });
}

async function fetchTargetQty(stationNos) {
  try {
    const response = await ipcRenderer.invoke("get-qty-target", stationNos);

    if (response.success && response.record) {
      console.log('goi thanh cong');
      
      document.getElementById("target-count").textContent = response.record.pr_qty;
    } else {
      console.error("Không có dữ liệu hoặc lỗi:", response.message);
      document.getElementById("target-count").textContent = "0";
    }
  } catch (err) {
    console.error("Lỗi khi gọi ipcRenderer:", err);
    document.getElementById("target-count").textContent = "0";
  }
}


fetchTargetQty();
setInterval(() => {
  fetchTargetQty(stationNos);
}, 2 * 60 * 60 * 1000);
const versionApp = process.env.VERSION_APP;

const versionElement = document.querySelector("title");
if (versionElement) {
  versionElement.textContent = `SCAN EPC ${versionApp}`;
}
