# Shows a Windows notification for the app ID in DISACTIVITY_APP_ID, silent since the app
# plays the sound the user picked. Windows only offers about 5 or 25 seconds on screen, so
# it is shown as "long" and hidden after DISACTIVITY_SECONDS. Title and text come from
# environment variables, so nothing needs quoting.
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

$title = [System.Security.SecurityElement]::Escape($env:DISACTIVITY_TITLE)
$body = [System.Security.SecurityElement]::Escape($env:DISACTIVITY_BODY)

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast duration=`"long`"><visual><binding template=`"ToastGeneric`"><text>$title</text><text>$body</text></binding></visual><audio silent=`"true`"/></toast>")

$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($env:DISACTIVITY_APP_ID)
$notifier.Show($toast)

Start-Sleep -Seconds ([int]$env:DISACTIVITY_SECONDS)
$notifier.Hide($toast)
