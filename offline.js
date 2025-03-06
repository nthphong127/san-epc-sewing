const loadingIndicator = document.getElementById("loading-indicator");

// Ẩn loading indicator ban đầu
loadingIndicator.style.display = "none";

// Lắng nghe sự kiện online
window.addEventListener("online", () => {
  console.log("Đã có mạng trở lại, đang đồng bộ dữ liệu, vui lòng chờ...");
  loadingIndicator.style.display = "flex";

  // Đợi 2 giây trước khi thực hiện đồng bộ
  setTimeout(() => {
    console.log("Syncing offline data...");

    ipcRenderer
      .invoke("sync-offline-data")
      .then((result) => {
        if (result && result.success) {
          console.log(result.message);
          fetchDataCount(); // Cập nhật số lượng dữ liệu
          renderTable(); // Cập nhật bảng dữ liệu
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
        // Ẩn loading indicator sau khi đồng bộ xong
        loadingIndicator.style.display = "none";
      });
  }, 2000);
});
