package be.gezinsbord.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Vraagt Android om de app buiten de batterijbeperking te houden, zodat ezan-alarmen op tijd afgaan. */
@CapacitorPlugin(name = "Battery")
public class BatteryPlugin extends Plugin {
    private boolean ignoring() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("ignoring", ignoring());
        call.resolve(r);
    }

    @PluginMethod
    public void requestIgnore(PluginCall call) {
        if (!ignoring() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                i.setData(Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(i);
            } catch (Exception e) {
                Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                getActivity().startActivity(i);
            }
        }
        JSObject r = new JSObject();
        r.put("ignoring", ignoring());
        call.resolve(r);
    }
}
