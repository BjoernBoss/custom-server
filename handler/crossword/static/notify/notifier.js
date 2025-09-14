function PushNotification(text, error) {
	const host = document.getElementById('notification-host');

	/* create the new notification */
	const notification = document.createElement('div');
	notification.classList.add('notification');

	/* add the caption */
	const caption = document.createElement('div');
	notification.appendChild(caption);
	caption.classList.add('text');
	if (error)
		caption.classList.add('error');
	caption.innerText = text;

	/* add the splitter */
	const splitter = document.createElement('div');
	notification.appendChild(splitter);
	splitter.classList.add('menu-splitter');

	/* add the close button */
	const close = document.createElement('div');
	notification.appendChild(close);
	close.classList.add('button');
	close.innerText = '\u2716';
	close.onclick = function () {
		notification.remove();
	};

	/* append the notification */
	host.appendChild(notification);
}
