const { ipcRenderer } = require("electron");

//**************Kiểm tra mạng************//
var tableBody = document.getElementById("table-body");
let previousMoNo = null;
let hasNotified = true;
const Datastore = require("nedb");
const successSound = new Audio("./assets/ting.ogg");
const errSound = new Audio("./assets/err.ogg");
const notiSound = new Audio("./assets/noti.ogg");
const errorDb = new Datastore({ filename: "errors.db", autoload: true });
const lastDb = new Datastore({ filename: "last.db", autoload: true });
const listScanDB = new Datastore({
  filename: "list-scan-daily.db",
  autoload: true,
});
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
  // Lấy dữ liệu từ backend
  const data = await fetchTableData();

  console.log("data", data);

  // Hiển thị dữ liệu trong bảng
  tableBody.innerHTML = ""; // Clear existing rows
  data.map((item) => {
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
          notiSound.play();
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

    console.log(keyid, "MMMM");

    if (confirmation) {
      const result = await ipcRenderer.invoke(
        "delete-epc-record",
        keyid,
        "M",
        epcCode
      );

      if (result.success) {
        console.log(`Deleted EPC Code: ${epcCode}`);
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
        .then((result) => {
          console.log("Stored procedure result:", result);
          if (result.success && result.returnValue == 0) {
            errSound.play();

            const notification = document.createElement("div");
            notification.className = "notification error";
            notification.innerText = `Tem quét chưa được phối hoặc bị lỗi: ${epcCode}`;
            document.body.appendChild(notification);

            // Ẩn thông báo sau 3 giây
            setTimeout(() => {
              notification.remove();
            }, 5000);

            // Thêm vào NeDB
            errorDb.find({ epcCode }, (err, docs) => {
              if (err) {
                console.error("Failed to query database:", err);
              } else if (docs.length > 0) {
                // Nếu epcCode đã tồn tại
                console.log(
                  `EPC ${epcCode} đã tồn tại trong cơ sở dữ liệu, không thêm nữa.`
                );
              } else {
                // Nếu epcCode chưa tồn tại, tiến hành thêm mới
                const errorEntry = {
                  epcCode,
                  timestamp: new Date().toISOString(),
                };
                errorDb.insert(errorEntry, (err, newDoc) => {
                  if (err) {
                    console.error("Failed to save error to database:", err);
                  } else {
                    console.log("Error saved to database:", newDoc);
                  }
                });
                updateErrorCount(); // Cập nhật số lượng
              }
            });

            errorList.push(epcCode);
            return;
          }

          if (result.success && result.returnValue == 1) {
            const updatedTime = formatDateTime();

            listScanDB.findOne({ epcCode }, (err, existingDoc) => {
              if (err) {
                console.error("DB find error:", err);
                return;
              }

              if (existingDoc) {
                // Đã tồn tại -> chỉ update updated
                listScanDB.update(
                  { epcCode },
                  { $set: { updated: updatedTime } },
                  {},
                  (updateErr, numReplaced) => {
                    if (updateErr) {
                      console.error("Failed to update document:", updateErr);
                    } else {
                      console.log("Document updated:", numReplaced);
                    }
                  }
                );
              } else {
                // Chưa có -> insert mới với timestamp và updated giống nhau
                const listScan = {
                  epcCode,
                  updated: updatedTime,
                  timestamp: updatedTime,
                };

                listScanDB.insert(listScan, (insertErr, newDoc) => {
                  if (insertErr) {
                    console.error("Failed to insert document:", insertErr);
                  } else {
                    console.log("Document inserted:", newDoc);
                  }
                });
              }
            });
          }

          if (result.success && result.returnValue == -1) {
            errSound.play();
            const notification = document.createElement("div");
            notification.className = "notification error";
            notification.innerText = `Tem đã được quét : ${epcCode}`;
            document.body.appendChild(notification);

            lastDb.find({ epcCode }, (err, docs) => {
              if (err) {
                console.error("Failed to query database:", err);
              } else if (docs.length > 0) {
                // Nếu epcCode đã tồn tại
                console.log(
                  `EPC ${epcCode} đã tồn tại trong cơ sở dữ liệu, không thêm nữa.`
                );
              } else {
                // Nếu epcCode chưa tồn tại, tiến hành thêm mới
                const lastEntry = {
                  epcCode,
                  timestamp: new Date().toISOString(),
                };
                lastDb.insert(lastEntry, (err, newDoc) => {
                  if (err) {
                    console.error("Failed to save error to database:", err);
                  } else {
                    console.log("Error saved to database:", newDoc);
                  }
                });
                updateLastCount(); // Cập nhật số lượng
              }
            });

            lastList.push(epcCode);

            setTimeout(() => {
              notification.remove();
            }, 5000);
          }
          renderTable();
          fetchDataCount();
          successAnimation.classList.remove("hidden");
          successAnimation.classList.add("show");
          if (hasNotified) {
            successSound.play();
            hasNotified = false;
          }

          // Ẩn animation sau 1.5 giây
          setTimeout(() => {
            successAnimation.classList.remove("show");
            successAnimation.classList.add("hidden");
          }, 1000);
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
  deleteIcon.textContent = "Xóa";
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
  console.log("Checking offline data to sync...");

  const loadingIndicator = document.getElementById("loading-indicator");
  loadingIndicator.style.display = "flex"; // Hiển thị trạng thái loading

  ipcRenderer
    .invoke("sync-offline-data")
    .then((result) => {
      if (result && result.success) {
        console.log(result.message);
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
    console.log("App started online. Syncing offline data...");

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
console.log("Station Number:", stationNo);

// Ghi vào HTML
const stationElement = document.querySelector("h2");
if (stationElement) {
  stationElement.textContent = `TRẠM ${stationNo}`;
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

// Cập nhật bảng tem lỗi
// function updateErrorTable() {
//   errorTableBody.innerHTML = ""; // Xóa nội dung cũ
//   if (errorList.length === 0) {
//     errorTableBody.innerHTML = `<tr><td colspan="2">Không có tem lỗi</td></tr>`;
//     return;
//   }
//   errorList.forEach((error, index) => {
//     const row = document.createElement("tr");
//     row.innerHTML = `
//       <td>${error}</td>

//     `;
//     errorTableBody.appendChild(row);
//   });

//   // Thêm sự kiện xóa cho từng nút
// }

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
      console.log("Current error count:", count);
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
        console.log(`Đã xóa ${numRemoved} bản ghi cũ.`);
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
      errorTableBody.innerHTML = `<tr><td colspan="2">Không có tem lỗi</td></tr>`;
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
      console.log(`Removed ${numRemoved} error(s) from database.`);
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
  modalLast.style.display = "flex";
});

function updateLastCount() {
  lastDb.count({}, (err, count) => {
    if (err) {
      console.error("Failed to count errors in database:", err);
    } else {
      const lastCountSpan = document.getElementById("last-count");
      lastCountSpan.textContent = count; // Hiển thị số lượng tem lỗi
      console.log("Current error count:", count);
    }
  });
}

updateLastCount();

// Cập nhật bảng tem lỗi
function updateLastTable() {
  lastTableBody.innerHTML = ""; // Xóa nội dung cũ
  if (lastList.length === 0) {
    lastTableBody.innerHTML = `<tr><td colspan="2">Không có tem lỗi</td></tr>`;
    return;
  }
  lastList.forEach((error, index) => {
    console.log("error-epc", error);

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
      console.log("Current last count:", count);
    }
  });
}

updateLastCount();
// xóa error cuối ngày

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
        console.log(`Đã xóa ${numRemoved} bản ghi cũ.`);
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
      lastTableBody.innerHTML = `<tr><td colspan="2">Không có tem lỗi</td></tr>`;
      return;
    }

    console.log(docs, "docs");

    docs.forEach((doc, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${doc.epcCode}</td>
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
      console.log(`Removed ${numRemoved} error(s) from database.`);
      updateLastTable(); // Cập nhật lại bảng
      updateLastCount(); // Cập nhật số lượng
    }
  });
}

const versionApp = process.env.VERSION_APP;

const versionElement = document.querySelector("title");
if (versionElement) {
  versionElement.textContent = `SCAN EPC ${versionApp}`;
}
function formatDateTime(date = new Date()) {
  const pad = (n) => (n < 10 ? "0" + n : n);
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    " " +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes()) +
    ":" +
    pad(date.getSeconds())
  );
}
