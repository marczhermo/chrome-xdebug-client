var Watches = (function() {

	var watches = [];
	var watches_line_selector;


	var publicMethods = {

		init: function() {
			watches_line_selector = "form.watches-line";

			$(watches_line_selector + " input[name=input]").on("focus", function(e) {
				$(this).removeClass("blurred");
			});

			$(watches_line_selector + " input[name=input]").on("blur", function(e) {
				$(this).addClass("blurred");
			});

			$(watches_line_selector).on("submit", function(e) {
				e.preventDefault();
				var $watch_line = $(this).find("[name=input]");
				var expression = $watch_line.val();
				var watch_id = $watch_line.closest(watches_line_selector).data("id");
				watches[watch_id] = {
					id: watch_id,
					expression: expression,
					value: ''
				};
				$(this).find("[name=input]").trigger("blur");
				Watches.refresh();
			});
		},

		refresh: function() {
			$("body").trigger("xdebug-eval-watches");
		},

		update: function(id, value) {
			watches[id].value = value;
		},

		get: function(id) {
			return watches[id];
		},

		display: function() {
			for (var id in watches) {
				$(watches_line_selector + "[data-id=" + id + "] .output").text(this.get(id).value);
			}
		},

		getAll: function() {
			return watches.slice();
		}

	}

	return publicMethods;

})();
