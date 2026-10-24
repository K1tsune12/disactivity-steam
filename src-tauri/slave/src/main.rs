#![windows_subsystem = "windows"]

use std::ptr::null_mut;
use std::env;
use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    ShowWindow, TranslateMessage, CS_HREDRAW, CS_VREDRAW, MSG, SW_SHOWMINNOACTIVE,
    WNDCLASSW, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_OVERLAPPEDWINDOW, WS_POPUP,
    WM_CLOSE, WM_DESTROY, WM_QUERYENDSESSION, WM_ENDSESSION,
};

/// Convert a Rust string to a null-terminated wide string for Windows API
fn to_wide_string(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_CLOSE => 0,
        WM_DESTROY => 0,
        WM_QUERYENDSESSION => 1,
        WM_ENDSESSION => 0,
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

fn main() {
    let exe_path = env::current_exe().unwrap_or_default();
    let exe_name = Path::new(&exe_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("DisactivitySlave");

    // Optional first argument overrides the window title (Steam library mode passes the game name)
    let title = env::args().nth(1).unwrap_or_else(|| exe_name.to_string());

    // Set by the app when "hide game windows" is on: a tool window keeps the window
    // (Discord needs one) but leaves it out of the taskbar and Alt+Tab
    let hide_window = env::var("DISACTIVITY_HIDE_WINDOW").is_ok();
    let ex_style = if hide_window {
        WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
    } else {
        WS_EX_APPWINDOW | WS_EX_NOACTIVATE
    };

    let class_name = to_wide_string("DisactivitySlaveClass");
    let window_title = to_wide_string(&title);

    unsafe {
        let hinstance = GetModuleHandleW(null_mut());

        let wc = WNDCLASSW {
            style: CS_HREDRAW | CS_VREDRAW,
            lpfnWndProc: Some(wndproc),
            cbClsExtra: 0,
            cbWndExtra: 0,
            hInstance: hinstance,
            hIcon: null_mut(),
            hCursor: null_mut(),
            hbrBackground: null_mut(),
            lpszMenuName: null_mut(),
            lpszClassName: class_name.as_ptr(),
        };

        RegisterClassW(&wc);

        // Using WS_EX_APPWINDOW so it appears in taskbar (some detection methods need this)
        // Using WS_EX_NOACTIVATE so it doesn't steal focus
        let hwnd = CreateWindowExW(
            ex_style,
            class_name.as_ptr(),
            window_title.as_ptr(),
            WS_POPUP | WS_OVERLAPPEDWINDOW,
            -32000, // Off-screen X
            -32000, // Off-screen Y
            1,
            1,
            null_mut(),
            null_mut(),
            hinstance,
            null_mut(),
        );

        ShowWindow(hwnd, SW_SHOWMINNOACTIVE);

        let mut msg: MSG = std::mem::zeroed();
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

