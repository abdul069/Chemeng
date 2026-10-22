package be.gezinsbord.app;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/** Kindertablet: de tablet op slot in Kinday (lock task mode) als de app device owner is, Kinday als startscherm,
 *  en toegelaten apps openen. Zonder device owner werkt alleen het startscherm en het openen van apps. */
@CapacitorPlugin(name = "Kiosk")
public class KioskPlugin extends Plugin {
    private DevicePolicyManager dpm() { return (DevicePolicyManager) getContext().getSystemService(Context.DEVICE_POLICY_SERVICE); }
    private ComponentName admin() { return new ComponentName(getContext(), KioskAdminReceiver.class); }
    private boolean isOwner() { DevicePolicyManager d = dpm(); return d != null && d.isDeviceOwnerApp(getContext().getPackageName()); }
    private boolean inLockTask() {
        ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
        return am != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }
    private boolean isLauncher() {
        Intent home = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
        ResolveInfo r = getContext().getPackageManager().resolveActivity(home, PackageManager.MATCH_DEFAULT_ONLY);
        return r != null && r.activityInfo != null && getContext().getPackageName().equals(r.activityInfo.packageName);
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("deviceOwner", isOwner()); r.put("lockTask", inLockTask()); r.put("launcher", isLauncher());
        call.resolve(r);
    }

    /** Welke pakketten mogen open tijdens de vergrendeling (altijd onszelf erbij). */
    @PluginMethod
    public void setAllowed(PluginCall call) {
        if (!isOwner()) { call.resolve(); return; }
        List<String> pkgs = new ArrayList<>();
        pkgs.add(getContext().getPackageName());
        JSArray arr = call.getArray("packages");
        if (arr != null) { try { for (Object o : arr.toList()) if (o != null && !pkgs.contains(o.toString())) pkgs.add(o.toString()); } catch (Exception ignored) {} }
        try {
            dpm().setLockTaskPackages(admin(), pkgs.toArray(new String[0]));
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                dpm().setLockTaskFeatures(admin(), DevicePolicyManager.LOCK_TASK_FEATURE_HOME | DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS | DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS);
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void start(PluginCall call) {
        Activity a = getActivity();
        if (a != null && isOwner()) {
            try {
                if (dpm().getLockTaskPackages(admin()).length == 0) dpm().setLockTaskPackages(admin(), new String[]{ getContext().getPackageName() });
                a.runOnUiThread(() -> { try { a.startLockTask(); } catch (Exception ignored) {} });
            } catch (Exception ignored) {}
        }
        JSObject r = new JSObject(); r.put("lockTask", isOwner()); call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Activity a = getActivity();
        if (a != null) a.runOnUiThread(() -> { try { a.stopLockTask(); } catch (Exception ignored) {} });
        call.resolve();
    }

    /** Android vragen om Kinday als startscherm te kiezen (opent het keuzescherm). Als device owner stellen we het meteen in. */
    @PluginMethod
    public void setLauncher(PluginCall call) {
        try {
            if (isOwner()) {
                android.content.IntentFilter f = new android.content.IntentFilter(Intent.ACTION_MAIN);
                f.addCategory(Intent.CATEGORY_HOME); f.addCategory(Intent.CATEGORY_DEFAULT);
                dpm().addPersistentPreferredActivity(admin(), f, new ComponentName(getContext(), MainActivity.class));
            } else {
                Intent i = new Intent(Settings.ACTION_HOME_SETTINGS); i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); getContext().startActivity(i);
            }
        } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void launch(PluginCall call) {
        String pkg = call.getString("package", "");
        JSObject r = new JSObject();
        try {
            Intent i = getContext().getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) { r.put("ok", false); call.resolve(r); return; }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            r.put("ok", true);
        } catch (Exception e) { r.put("ok", false); }
        call.resolve(r);
    }
}
