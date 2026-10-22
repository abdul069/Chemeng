package be.gezinsbord.app;

import android.app.admin.DeviceAdminReceiver;

/** Nodig om de app als "device owner" te kunnen instellen (QR-provisionering van een fabrieksnieuwe tablet). */
public class KioskAdminReceiver extends DeviceAdminReceiver {}
